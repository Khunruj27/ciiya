/* global __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline Node CommonJS harness loads installed tooling, not app bundle imports. */
/* Offline regression only: no environment files, servers, remote fetch or real database writes. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('../node_modules/typescript');
const sdk = require('../node_modules/@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const tokenOwner = '11111111-1111-4111-8111-111111111111';
const cookieOwner = '22222222-2222-4222-8222-222222222222';
const syncOwner = '33333333-3333-4333-8333-333333333333';
const albumId = '44444444-4444-4444-8444-444444444444';
const deviceId = '55555555-5555-4555-8555-555555555555';
const fixtureToken = 'offline.user.signature';
const syncToken = `ciiya_sync_${'A'.repeat(43)}`;
const fixtureEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-offline.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'offline-admin-key',
};

function load(relative, mocks, env, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleUnderTest = { exports: {} };
  cache.set(filename, moduleUnderTest);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const requireLocal = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    const resolved = specifier.startsWith('@/')
      ? path.resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : null;
    if (!resolved) throw new Error(`Unmocked external dependency: ${specifier}`);
    return load(path.relative(root, `${resolved}.ts`), mocks, env, cache);
  };
  new Function('require', 'module', 'exports', 'process', 'console', compiled)(
    requireLocal, moduleUnderTest, moduleUnderTest.exports, { env },
    { error() {}, warn() {}, log() {} },
  );
  return moduleUnderTest.exports;
}

function harness({
  authorization = `Bearer ${fixtureToken}`,
  ambientAuthorization = 'Bearer unrelated.ambient.identity',
  tokenUser = { id: tokenOwner },
  tokenError = null,
  browserUser = { id: cookieOwner },
  browserError = null,
  insertError = null,
  syncScopes = ['albums:read', 'photos:upload'],
  syncFound = true,
  syncRevoked = false,
  syncExpired = false,
  syncMode = 'all',
  syncCanaryOwners = '',
  workerSecret,
  createOverride,
} = {}) {
  const env = { ...fixtureEnv, CIIYA_SYNC_ROLLOUT_MODE: syncMode, CIIYA_SYNC_CANARY_OWNER_IDS: syncCanaryOwners, WORKER_SECRET: 'offline-worker-fixture' };
  const created = [], inserts = [], syncQueries = [], browserAuthCalls = [], tokenAuthCalls = [], rateCalls = [], rpcCalls = [];
  let browserHelperCalls = 0, ambientHeaderReads = 0, cookieReads = 0, bodyReads = 0;
  const requestHeaders = new Headers({ cookie: 'browser-user=B' });
  if (authorization !== null) requestHeaders.set('authorization', authorization);
  if (workerSecret !== undefined) requestHeaders.set('x-worker-secret', workerSecret);
  const ambientHeaders = new Headers({ cookie: 'ambient-browser-user=B' });
  if (ambientAuthorization !== null) ambientHeaders.set('authorization', ambientAuthorization);

  function userClient(identity, authCalls) {
    const client = {
      auth: { async getUser(...args) {
        authCalls.push(args);
        const isTokenClient = identity === 'token';
        return { data: { user: isTokenClient ? tokenUser : browserUser }, error: isTokenClient ? tokenError : browserError };
      } },
      async rpc(name, parameters) {
        rpcCalls.push({ identity, name, parameters });
        throw new Error('Boundary fixture must not call mutation RPCs');
      },
      from(table) {
        assert.equal(table, 'albums', 'The creation fixture permits album insertion only');
        const query = {
          insert(row) { inserts.push({ identity, client, row }); return query; },
          select(columns) { assert.equal(columns, '*'); return query; },
          async single() { return { data: insertError ? null : { id: albumId, ...inserts.at(-1).row }, error: insertError }; },
        };
        return query;
      },
    };
    return client;
  }

  const browserClient = userClient('cookie', browserAuthCalls);
  const tokenClient = userClient('token', tokenAuthCalls);
  const syncClient = {
    async rpc(name, parameters) {
      rpcCalls.push({ identity: 'sync', name, parameters });
      throw new Error('Boundary fixture must not call mutation RPCs');
    },
    from(table) {
      assert.equal(table, 'ciiya_sync_devices');
      const call = { table, filters: [] };
      syncQueries.push(call);
      const query = {
        select(columns) { assert.ok(!columns.includes('token_hash')); return query; },
        eq(field, value) { call.filters.push(['eq', field, value]); return query; },
        is(field, value) { call.filters.push(['is', field, value]); return query; },
        gt(field, value) { call.filters.push(['gt', field, value]); return query; },
        async maybeSingle() {
          const hasCorrectHash = call.filters.some(([op, field, value]) => op === 'eq' && field === 'token_hash' && value === crypto.createHash('sha256').update(syncToken).digest('hex'));
          assert.ok(call.filters.some(([op, field, value]) => op === 'is' && field === 'revoked_at' && value === null));
          assert.ok(call.filters.some(([op, field]) => op === 'gt' && field === 'token_expires_at'));
          return { error: null, data: syncFound && hasCorrectHash && !syncRevoked && !syncExpired ? {
            id: deviceId, owner_id: syncOwner, scopes: syncScopes,
            last_seen_at: new Date().toISOString(),
          } : null };
        },
        update() { throw new Error('Fresh offline Sync heartbeat must not be updated'); },
      };
      return query;
    },
  };
  const cache = new Map();
  const mocks = {
    crypto, 'node:crypto': crypto,
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    'next/headers': {
      async headers() { ambientHeaderReads++; return ambientHeaders; },
      cookies() { cookieReads++; throw new Error('The mobile helper must not consult cookies'); },
    },
    '@/lib/supabase-server': { async createServerSupabaseClient() { browserHelperCalls++; return browserClient; } },
    '@/lib/get-user-storage-plan': { getUserStoragePlan() { throw new Error('Boundary test must not read quota'); } },
    '@/lib/rate-limit': {
      async rateLimit(_request, options) { rateCalls.push(options); return { allowed: true }; },
      tooManyRequests() { throw new Error('The offline boundary fixture is not rate-limited'); },
    },
    '@/lib/storage': {
      assertOwnedAlbumObjectKey() { throw new Error('Boundary test must not inspect stored objects'); },
      createStorageRef() { throw new Error('Boundary test must not construct storage objects'); },
      getStorageAdapter() { throw new Error('Boundary test must not call storage'); },
      resolvePresetStorageRef() { throw new Error('Boundary test must not inspect presets'); },
      resolvePhotoDelivery() { throw new Error('Boundary test must not resolve a stored photo'); },
    },
    '@/lib/storage/photo-upload-policy': { MAX_DIRECT_PHOTO_UPLOAD_BYTES: 256 * 1024 * 1024 },
    '@supabase/supabase-js': { createClient(...args) {
      created.push(args);
      if (args[1] === fixtureEnv.SUPABASE_SERVICE_ROLE_KEY) return syncClient;
      assert.equal(args[1], fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Native requests must not gain a service role');
      return createOverride ? createOverride(...args) : tokenClient;
    } },
  };
  return {
    created, inserts, syncQueries, browserAuthCalls, tokenAuthCalls, rateCalls, rpcCalls, browserClient, tokenClient, syncClient,
    get browserHelperCalls() { return browserHelperCalls; },
    get ambientHeaderReads() { return ambientHeaderReads; },
    get cookieReads() { return cookieReads; },
    get bodyReads() { return bodyReads; },
    helper: load('src/lib/mobile/server-client.ts', mocks, env, cache).createMobileSupabaseClient,
    async create(body = { title: ' Offline album ', description: ' Description ', owner_id: cookieOwner, user_id: cookieOwner }) {
      const { POST } = load('src/app/api/albums/create/route.ts', mocks, env, cache);
      return POST({ headers: requestHeaders, async json() { bodyReads++; return body; } });
    },
    async principal() {
      const { resolvePhotoUploadPrincipal } = load('src/lib/photo-upload-principal.ts', mocks, env, cache);
      return resolvePhotoUploadPrincipal({ request: { headers: requestHeaders }, browserClient });
    },
    async finalize(body) {
      const { POST } = load('src/app/api/photos/finalize-upload/route.ts', mocks, env, cache);
      return POST({ headers: requestHeaders, async json() { bodyReads++; return body; } });
    },
    async cancel(body) {
      const { DELETE } = load('src/app/api/photos/upload-url/route.ts', mocks, env, cache);
      return DELETE({ headers: requestHeaders, async json() { bodyReads++; return body; } });
    },
  };
}

const invalidCredentials = ['', ' ', 'Basic a.b.c', 'Bearer a.b', 'Bearer a.b.c.d', 'Bearer a.b.c extra', 'Bearer ciiya_sync_offline', 'a.b.c'];

test('an explicit absent or malformed mobile credential cannot inherit the ambient header or browser cookie', async () => {
  for (const authorization of [null, ...invalidCredentials, `Bearer ${syncToken}`]) {
    const h = harness();
    assert.equal(await h.helper(authorization), null);
    assert.equal(h.ambientHeaderReads, 0);
    assert.equal(h.cookieReads, 0);
    assert.equal(h.created.length, 0);
    assert.equal(h.browserAuthCalls.length, 0);
  }
});

test('omitted mobile helper argument retains existing async Next-header behavior without reading cookies', async () => {
  const h = harness({ ambientAuthorization: `Bearer ${fixtureToken}` });
  assert.equal(await h.helper(), h.tokenClient);
  assert.equal(h.ambientHeaderReads, 1);
  assert.equal(h.cookieReads, 0);
  assert.equal(h.created[0][2].global.headers.Authorization, `Bearer ${fixtureToken}`);
});

test('an explicit native token uses only the public key, with no cookie or persistent session state', async () => {
  const h = harness();
  assert.equal(await h.helper(`Bearer ${fixtureToken}`), h.tokenClient);
  assert.deepEqual(h.created, [[fixtureEnv.NEXT_PUBLIC_SUPABASE_URL, fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${fixtureToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }]]);
  assert.equal(h.ambientHeaderReads, 0);
  assert.equal(h.cookieReads, 0);
  assert.equal(h.tokenAuthCalls.length, 0, 'A JWT shape must not assert an authenticated identity');
});

test('album creation uses token A as both owner and database client despite cookie B and an unrelated ambient token', async () => {
  const h = harness();
  const response = await h.create();
  assert.equal(response.status, 201);
  assert.deepEqual(h.tokenAuthCalls, [[]]);
  assert.equal(h.browserHelperCalls, 0);
  assert.deepEqual(h.browserAuthCalls, []);
  assert.equal(h.ambientHeaderReads, 0);
  assert.equal(h.inserts.length, 1);
  assert.equal(h.inserts[0].client, h.tokenClient);
  assert.equal(h.inserts[0].row.owner_id, tokenOwner);
  assert.equal(h.inserts[0].row.user_id, tokenOwner);
  assert.equal(h.inserts[0].row.title, 'Offline album');
  assert.equal(h.inserts[0].row.description, 'Description');
  assert.equal((await response.json()).album.owner_id, tokenOwner);
});

test('empty, malformed and Sync Authorization headers reject creation without cookie fallback or a database write', async () => {
  for (const authorization of [...invalidCredentials, `Bearer ${syncToken}`]) {
    const h = harness({ authorization });
    const response = await h.create();
    assert.equal(response.status, 401, `Must reject explicit credential: ${JSON.stringify(authorization)}`);
    assert.equal(h.browserHelperCalls, 0);
    assert.deepEqual(h.browserAuthCalls, []);
    assert.equal(h.created.length, 0);
    assert.equal(h.inserts.length, 0);
    assert.equal(h.bodyReads, 0);
  }
});

test('unverifiable or errored native identities fail creation before body reads or insertion', async () => {
  for (const options of [{ tokenUser: null }, { tokenUser: { id: tokenOwner }, tokenError: { message: 'offline identity failure' } }]) {
    const h = harness(options);
    assert.equal((await h.create()).status, 401);
    assert.deepEqual(h.tokenAuthCalls, [[]]);
    assert.equal(h.browserHelperCalls, 0);
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.inserts.length, 0);
    assert.equal(h.bodyReads, 0);
  }
});

test('creation without an Authorization header preserves the browser cookie identity', async () => {
  const h = harness({ authorization: null });
  const response = await h.create();
  assert.equal(response.status, 201);
  assert.equal(h.browserHelperCalls, 1);
  assert.deepEqual(h.browserAuthCalls, [[]]);
  assert.equal(h.created.length, 0);
  assert.equal(h.inserts[0].client, h.browserClient);
  assert.equal(h.inserts[0].row.owner_id, cookieOwner);
  assert.equal(h.inserts[0].row.user_id, cookieOwner);
});

test('browser and native creation retain identical existing website public/download/upload/face defaults', async () => {
  const rows = [];
  for (const authorization of [null, `Bearer ${fixtureToken}`]) {
    const h = harness({ authorization });
    assert.equal((await h.create({ title: 'Default album' })).status, 201);
    const row = h.inserts[0].row;
    assert.deepEqual({
      status: row.status,
      is_public: row.is_public,
      allow_download: row.allow_download,
      allow_original_download: row.allow_original_download,
      download_size: row.download_size,
      upload_mode: row.upload_mode,
      upload_size: row.upload_size,
      upload_profile: row.upload_profile,
      album_preset_path: row.album_preset_path,
      auto_publish: row.auto_publish,
      auto_face_scan: row.auto_face_scan,
      camera_status: row.camera_status,
      camera_connection_type: row.camera_connection_type,
      photo_count: row.photo_count,
      total_size_bytes: row.total_size_bytes,
      view_count: row.view_count,
      share_count: row.share_count,
    }, {
      status: 'active', is_public: true, allow_download: true, allow_original_download: false,
      download_size: 'hd', upload_mode: 'manual', upload_size: 'uhd', upload_profile: 'professional',
      album_preset_path: null, auto_publish: true, auto_face_scan: true,
      camera_status: 'disconnected', camera_connection_type: 'none',
      photo_count: 0, total_size_bytes: 0, view_count: 0, share_count: 0,
    });
    assert.match(row.share_token, /^[a-f0-9]{32}$/);
    rows.push(row.share_token);
  }
  assert.notEqual(rows[0], rows[1]);
});

test('existing valid upload settings and explicit false publishing/face flags are preserved for browser and native', async () => {
  for (const authorization of [null, `Bearer ${fixtureToken}`]) {
    const h = harness({ authorization });
    assert.equal((await h.create({
      title: 'Configured album', uploadMode: 'auto', uploadSize: 'original', uploadProfile: 'quick',
      albumPresetPath: ' fixture/preset.xmp ', autoPublish: false, autoFaceScan: false,
    })).status, 201);
    const row = h.inserts[0].row;
    assert.equal(row.upload_mode, 'auto');
    assert.equal(row.upload_size, 'original');
    assert.equal(row.upload_profile, 'quick');
    assert.equal(row.album_preset_path, 'fixture/preset.xmp');
    assert.equal(row.auto_publish, false);
    assert.equal(row.auto_face_scan, false);
  }
});

test('blank title is rejected after authentication and cannot create an album', async () => {
  for (const authorization of [null, `Bearer ${fixtureToken}`]) {
    const h = harness({ authorization });
    const response = await h.create({ title: '   ' });
    assert.equal(response.status, 400);
    assert.equal(h.inserts.length, 0);
  }
});

test('upload principal binds verified native token A to the same token-scoped database client, never cookie B', async () => {
  const h = harness();
  const result = await h.principal();
  assert.equal(result.principal.kind, 'browser', 'User uploads retain the existing user RPC branch');
  assert.equal(result.principal.ownerId, tokenOwner);
  assert.equal(result.principal.deviceId, null);
  assert.equal(result.principal.client, h.tokenClient);
  assert.equal(result.explicitCredential, true);
  assert.equal(result.rolloutDisabled, false);
  assert.deepEqual(h.tokenAuthCalls, [[]]);
  assert.deepEqual(h.browserAuthCalls, []);
  assert.equal(h.syncQueries.length, 0);
  assert.equal(h.ambientHeaderReads, 0);
  assert.equal(h.created[0][2].global.headers.Authorization, `Bearer ${fixtureToken}`);
});

test('a rejected native upload token does not fall back to cookies or the Sync authenticator', async () => {
  for (const options of [{ tokenUser: null }, { tokenUser: { id: tokenOwner }, tokenError: { message: 'offline identity failure' } }]) {
    const h = harness(options);
    assert.deepEqual(await h.principal(), { principal: null, explicitCredential: true, rolloutDisabled: false });
    assert.deepEqual(h.tokenAuthCalls, [[]]);
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.syncQueries.length, 0);
  }
});

test('empty and malformed upload headers are explicit failures and cannot inherit browser cookies', async () => {
  for (const authorization of invalidCredentials) {
    const h = harness({ authorization });
    assert.deepEqual(await h.principal(), { principal: null, explicitCredential: true, rolloutDisabled: false });
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.tokenAuthCalls.length, 0);
    assert.equal(h.created.length, 0);
    assert.equal(h.syncQueries.length, 0);
  }
});

test('upload without an Authorization header retains the cookie client and bypasses the Sync pause', async () => {
  const h = harness({ authorization: null, syncMode: 'off' });
  const result = await h.principal();
  assert.equal(result.principal.ownerId, cookieOwner);
  assert.equal(result.principal.client, h.browserClient);
  assert.equal(result.principal.kind, 'browser');
  assert.equal(result.explicitCredential, false);
  assert.equal(result.rolloutDisabled, false);
  assert.deepEqual(h.browserAuthCalls, [[]]);
  assert.equal(h.created.length, 0);
});

test('native user uploads are not governed by the independent Sync rollout gate', async () => {
  const h = harness({ syncMode: 'off' });
  const result = await h.principal();
  assert.equal(result.principal.ownerId, tokenOwner);
  assert.equal(result.principal.client, h.tokenClient);
  assert.equal(result.rolloutDisabled, false);
});

test('missing browser session returns an implicit unauthenticated principal', async () => {
  const h = harness({ authorization: null, browserUser: null });
  assert.deepEqual(await h.principal(), { principal: null, explicitCredential: false, rolloutDisabled: false });
  assert.deepEqual(h.browserAuthCalls, [[]]);
  assert.equal(h.created.length, 0);
});

test('valid non-JWT Sync credential retains the actual scoped authenticator and its admin database client', async () => {
  const h = harness({ authorization: `Bearer ${syncToken}` });
  const result = await h.principal();
  assert.equal(result.principal.kind, 'ciiya-sync');
  assert.equal(result.principal.ownerId, syncOwner);
  assert.equal(result.principal.deviceId, deviceId);
  assert.equal(result.principal.client, h.syncClient);
  assert.equal(result.explicitCredential, true);
  assert.equal(result.rolloutDisabled, false);
  assert.equal(h.syncQueries.length, 1);
  assert.equal(h.created[0][1], fixtureEnv.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(h.tokenAuthCalls.length, 0);
  assert.equal(h.browserAuthCalls.length, 0);
});

test('Sync scope, revocation, expiry and unknown-token failures cannot fall back to browser or native identity', async () => {
  for (const options of [
    { syncScopes: ['albums:read'] }, { syncFound: false }, { syncRevoked: true }, { syncExpired: true },
    { authorization: `Bearer ciiya_sync_${'B'.repeat(43)}` },
  ]) {
    const h = harness({ authorization: `Bearer ${syncToken}`, ...options });
    assert.deepEqual(await h.principal(), { principal: null, explicitCredential: true, rolloutDisabled: false });
    assert.equal(h.syncQueries.length, 1);
    assert.equal(h.tokenAuthCalls.length, 0);
    assert.equal(h.browserAuthCalls.length, 0);
  }
});

test('valid Sync credentials still respect pause, invalid rollout configuration and canary ownership', async () => {
  for (const options of [
    { syncMode: 'off' }, { syncMode: 'invalid' }, { syncMode: 'canary', syncCanaryOwners: tokenOwner },
  ]) {
    const h = harness({ authorization: `Bearer ${syncToken}`, ...options });
    assert.deepEqual(await h.principal(), { principal: null, explicitCredential: true, rolloutDisabled: true });
    assert.equal(h.syncQueries.length, 1);
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.tokenAuthCalls.length, 0);
  }
  const enabled = harness({ authorization: `Bearer ${syncToken}`, syncMode: 'canary', syncCanaryOwners: syncOwner });
  assert.equal((await enabled.principal()).principal.client, enabled.syncClient);
});

test('installed Supabase SDK verifies native identity using that client bearer and public key, without a cookie', async () => {
  const calls = [];
  const h = harness({ createOverride: (url, key, options) => sdk.createClient(url, key, {
    ...options,
    global: { ...options.global, fetch: async (url, options) => {
      const headers = new Headers(options.headers);
      calls.push({ url: String(url), method: options.method, headers });
      assert.equal(headers.get('authorization'), `Bearer ${fixtureToken}`);
      assert.equal(headers.get('apikey'), fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      assert.equal(headers.get('cookie'), null);
      return Response.json({ id: tokenOwner, aud: 'authenticated' });
    } },
  }) });
  const result = await h.principal();
  assert.equal(result.principal.ownerId, tokenOwner);
  assert.notEqual(result.principal.client, h.browserClient);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${fixtureEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`);
  assert.equal(calls[0].method, 'GET');
  assert.equal(h.browserAuthCalls.length, 0);
  assert.equal(h.ambientHeaderReads, 0);
});

test('authenticated native finalization rejects omitted or Supabase storage before any data/storage mutation', async () => {
  for (const body of [{}, { storageProvider: 'supabase' }]) {
    const h = harness();
    const response = await h.finalize(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Mobile uploads require R2 storage' });
    assert.deepEqual(h.tokenAuthCalls, [[]]);
    assert.deepEqual(h.browserAuthCalls, []);
    assert.equal(h.created.length, 1, 'Only the public-key native authentication client may be constructed');
    assert.equal(h.created[0][1], fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    assert.equal(h.inserts.length, 0);
    assert.equal(h.syncQueries.length, 0);
    assert.equal(h.rateCalls.length, 0);
  }
});

test('native R2 finalization passes the new provider guard while invalid providers keep their earlier rejection', async () => {
  for (const [storageProvider, message] of [
    ['r2', 'Missing required upload data'], ['unknown', 'Invalid storage provider'],
  ]) {
    const h = harness();
    const response = await h.finalize({ storageProvider });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: message });
    assert.equal(h.created.length, 1);
    assert.equal(h.inserts.length, 0);
    assert.equal(h.browserAuthCalls.length, 0);
  }
});

test('browser-cookie finalization preserves its existing legacy Supabase and R2 paths', async () => {
  for (const body of [{}, { storageProvider: 'supabase' }, { storageProvider: 'r2' }]) {
    const h = harness({ authorization: null });
    const response = await h.finalize(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Missing required upload data' });
    assert.deepEqual(h.browserAuthCalls, [[]]);
    assert.equal(h.tokenAuthCalls.length, 0);
    assert.equal(h.created.length, 0);
    assert.equal(h.inserts.length, 0);
  }
});

test('Sync finalization retains its separate R2-only requirement and device rate-limit identity', async () => {
  for (const [storageProvider, message] of [
    ['supabase', 'Ciiya Sync uploads require R2 storage'], ['r2', 'Missing required upload data'],
  ]) {
    const h = harness({ authorization: `Bearer ${syncToken}` });
    const response = await h.finalize({ storageProvider });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: message });
    assert.deepEqual(h.rateCalls, [{
      bucket: 'ciiya-sync-photo-finalize', identifier: deviceId, limit: 600, windowSeconds: 10 * 60,
    }]);
    assert.equal(h.created.length, 1, 'Only the existing Sync authenticator admin client may be constructed');
    assert.equal(h.syncQueries.length, 1);
    assert.equal(h.inserts.length, 0);
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.tokenAuthCalls.length, 0);
  }
});

test('finalization rejects empty/malformed/unverifiable native auth before reading upload body or storage', async () => {
  for (const options of [
    ...invalidCredentials.map((authorization) => ({ authorization })),
    { tokenUser: null }, { tokenUser: { id: tokenOwner }, tokenError: { message: 'offline identity failure' } },
  ]) {
    const h = harness(options);
    const response = await h.finalize({ storageProvider: 'r2' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    assert.equal(h.bodyReads, 0);
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.inserts.length, 0);
    assert.equal(h.syncQueries.length, 0);
  }
});

test('the native R2-only guard does not change authenticated worker legacy registration or camera binding checks', async () => {
  for (const [body, message] of [
    [{}, 'Missing required upload data'],
    [{ storageProvider: 'supabase' }, 'Missing required upload data'],
    [{ storageProvider: 'r2' }, 'Missing camera import binding'],
  ]) {
    const h = harness({ workerSecret: 'offline-worker-fixture' });
    const response = await h.finalize(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: message });
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.tokenAuthCalls.length, 0);
    assert.equal(h.created.length, 0);
    assert.equal(h.syncQueries.length, 0);
    assert.equal(h.inserts.length, 0);
  }
});

test('an invalid explicit worker secret still fails before native/browser auth or body reads', async () => {
  const h = harness({ workerSecret: 'wrong-offline-worker' });
  const response = await h.finalize({ storageProvider: 'r2' });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unauthorized' });
  assert.equal(h.browserAuthCalls.length, 0);
  assert.equal(h.tokenAuthCalls.length, 0);
  assert.equal(h.bodyReads, 0);
  assert.equal(h.created.length, 0);
});

test('authenticated native DELETE cannot cancel a reservation or delete an accepted original', async () => {
  for (const body of [{}, { uploadSessionId: albumId }]) {
    const h = harness();
    const response = await h.cancel(body);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.deepEqual(await response.json(), {
      error: 'Mobile upload cancellation is not enabled', code: 'MOBILE_UPLOAD_CANCELLATION_DISABLED',
    });
    assert.deepEqual(h.tokenAuthCalls, [[]]);
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.bodyReads, 0);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.inserts.length, 0);
    assert.equal(h.created.length, 1);
    assert.equal(h.created[0][1], fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  }
});

test('empty/malformed/unverifiable cancellation credentials reject before body reads or mutation RPCs', async () => {
  for (const options of [
    ...invalidCredentials.map((authorization) => ({ authorization })),
    { tokenUser: null }, { tokenUser: { id: tokenOwner }, tokenError: { message: 'offline identity failure' } },
  ]) {
    const h = harness(options);
    const response = await h.cancel({ uploadSessionId: albumId });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    assert.equal(h.bodyReads, 0);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.syncQueries.length, 0);
  }
});

test('cookie and Sync cancellation retain their earlier invalid-session flow without new mobile denial', async () => {
  for (const authorization of [null, `Bearer ${syncToken}`]) {
    const h = harness({ authorization });
    const response = await h.cancel({});
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid upload session', code: 'INVALID_REQUEST' });
    assert.equal(h.bodyReads, 1);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.inserts.length, 0);
    assert.equal(h.tokenAuthCalls.length, 0);
    if (authorization === null) assert.deepEqual(h.browserAuthCalls, [[]]);
    else {
      assert.equal(h.browserAuthCalls.length, 0);
      assert.equal(h.syncQueries.length, 1);
    }
  }
});

test('Sync cancellation retains rollout pause and scope denial before request body or mutation access', async () => {
  for (const [options, status, code] of [
    [{ syncMode: 'off' }, 503, 'CIIYA_SYNC_ROLLOUT_PAUSED'],
    [{ syncScopes: ['albums:read'] }, 401, 'UNAUTHORIZED'],
  ]) {
    const h = harness({ authorization: `Bearer ${syncToken}`, ...options });
    const response = await h.cancel({ uploadSessionId: albumId });
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.equal(h.bodyReads, 0);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.browserAuthCalls.length, 0);
    assert.equal(h.tokenAuthCalls.length, 0);
  }
});
