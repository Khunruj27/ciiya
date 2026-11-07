/* global __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline harness loads installed tooling only. */
/* Synthetic identities/DB rows only. Never starts a server or reads real environment files. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const bcrypt = require('../node_modules/bcryptjs');
const ts = require('../node_modules/typescript');

const root = path.resolve(__dirname, '..');
const routePath = 'src/app/api/mobile/albums/[id]/access/route.ts';
const ownerId = '11111111-1111-4111-8111-111111111111';
const otherOwnerId = '22222222-2222-4222-8222-222222222222';
const albumId = '33333333-3333-4333-8333-333333333333';
const otherAlbumId = '44444444-4444-4444-8444-444444444444';
const accessToken = 'offline.user.signature';
const privateMarker = 'offline-private-error-secret';
const oldHash = bcrypt.hashSync('offline-existing-password', 10);
const newHash = bcrypt.hashSync('offline-new-password', 10);
const fixtureEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-offline.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'offline-admin-key-must-never-be-used',
};
const accessFields = ['allow_download', 'allow_original_download', 'download_size', 'is_password_protected', 'password_hash'];
const allowedColumns = ['id', ...accessFields];

function load(relative, mocks, output, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const underTest = { exports: {} };
  cache.set(filename, underTest);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const requireLocal = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    const target = specifier.startsWith('@/') ? path.resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : null;
    if (!target) throw new Error(`Unmocked dependency: ${specifier}`);
    return load(path.relative(root, `${target}.ts`), mocks, output, cache);
  };
  const noNetwork = () => { throw new Error('Album access tests must never use fetch'); };
  const quietConsole = Object.fromEntries(['log', 'warn', 'error', 'info'].map((method) => [method, (...values) => output.push({ method, values })]));
  new Function('require', 'module', 'exports', 'process', 'console', 'fetch', compiled)(
    requireLocal, underTest, underTest.exports, { env: fixtureEnv }, quietConsole, noNetwork,
  );
  return underTest.exports;
}

function defaultRow(overrides = {}) {
  return {
    id: albumId, owner_id: ownerId, status: 'active', allow_download: true,
    allow_original_download: false, download_size: 'hd',
    is_password_protected: false, password_hash: null, ...overrides,
  };
}

function harness(options = {}) {
  const calls = [], clients = [], output = [], hashCalls = [];
  let row = Object.hasOwn(options, 'row') ? options.row : defaultRow();
  let bodyReads = 0, authCalls = 0, cookieReads = 0, ambientReads = 0;
  const verifiedOwner = Object.hasOwn(options, 'user') ? options.user?.id : ownerId;
  const client = {
    auth: { async getUser() {
      authCalls++;
      if (options.authThrows) throw new Error(privateMarker);
      return { data: { user: Object.hasOwn(options, 'user') ? options.user : { id: ownerId } }, error: options.authError || null };
    } },
    from(table) {
      assert.equal(table, 'albums', 'Only the albums table is in scope');
      const call = { operation: 'select', columns: null, filters: [], payload: null };
      calls.push(call);
      const query = {
        select(columns) {
          assert.ok(columns.split(',').every((column) => allowedColumns.includes(column)), 'No share token, original URL, metadata or other private columns');
          call.columns = columns;
          return query;
        },
        update(payload) {
          assert.deepEqual(Object.keys(payload).sort(), [...accessFields].sort(), 'Only access fields are writable');
          call.operation = 'update'; call.payload = payload;
          return query;
        },
        eq(field, value) { call.filters.push(['eq', field, value]); return query; },
        is(field, value) { assert.equal(value, null); call.filters.push(['is', field, value]); return query; },
        async maybeSingle() {
          assert.equal(call.filters.find(([, field]) => field === 'owner_id')?.[2], verifiedOwner);
          assert.equal(call.filters.find(([, field]) => field === 'id')?.[2], options.requestedId || albumId);
          assert.ok(call.filters.some(([, field, value]) => field === 'status' && value === 'active'));
          if (call.operation === 'update') {
            assert.equal(call.columns, 'id', 'Only confirmed matching ID can acknowledge a write');
            for (const field of accessFields) assert.equal(call.filters.filter(([, name]) => name === field).length, 1, `CAS binds ${field}`);
            if (options.updateThrows) throw new Error(privateMarker);
            if (options.updateRace && row) row = { ...row, ...options.updateRace };
            if (options.updateError) return { data: null, error: options.updateError };
            if (Object.hasOwn(options, 'updated')) return { data: options.updated, error: null };
          } else {
            if (options.readThrows) throw new Error(privateMarker);
            if (options.readError) return { data: null, error: options.readError };
            if (options.returnMalformed) return { data: options.returnMalformed, error: null };
          }
          if (!row || !call.filters.every(([, field, value]) => row[field] === value)) return { data: null, error: null };
          if (call.operation === 'update') row = { ...row, ...call.payload };
          return { data: Object.fromEntries(call.columns.split(',').map((column) => [column, row[column]])), error: null };
        },
        insert() { throw new Error('Access endpoint cannot insert'); },
        delete() { throw new Error('Access endpoint cannot delete'); },
      };
      return query;
    },
    rpc() { throw new Error('Access endpoint cannot use mutation RPC'); },
    get storage() { throw new Error('Access endpoint cannot touch storage'); },
  };
  const cache = new Map();
  const mocks = {
    'node:crypto': crypto,
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/headers': {
      async headers() { ambientReads++; throw new Error('No ambient auth'); },
      cookies() { cookieReads++; throw new Error('No browser-cookie fallback'); },
    },
    '@supabase/supabase-js': { createClient(...args) {
      clients.push(args);
      assert.equal(args[1], fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Never use service-role credentials');
      if (options.clientThrows) throw new Error(privateMarker);
      return client;
    } },
    bcryptjs: { async hash(password, rounds) {
      hashCalls.push([password, rounds]);
      if (options.hashThrows) throw new Error(privateMarker);
      if (options.hashHook && row) row = { ...row, ...options.hashHook };
      if (options.realHash) return bcrypt.hash(password, rounds);
      return Object.hasOwn(options, 'hashResult') ? options.hashResult : newHash;
    } },
  };
  const helpers = load('src/lib/mobile/album-access.ts', mocks, output, cache);
  return {
    helpers, calls, clients, output, hashCalls,
    get row() { return row; },
    get bodyReads() { return bodyReads; },
    get authCalls() { return authCalls; },
    get cookieReads() { return cookieReads; },
    get ambientReads() { return ambientReads; },
    get writes() { return calls.filter((call) => call.operation === 'update'); },
    input(overrides = {}) {
      return { allowDownload: true, downloadSize: 'hd', isPasswordProtected: false, password: '', revision: helpers.albumAccessRevision(row), ...overrides };
    },
    async request(method = 'GET', body, id = albumId) {
      options.requestedId = id.toLowerCase();
      const route = load(routePath, mocks, output, cache);
      assert.equal(route.runtime, 'nodejs'); assert.equal(route.dynamic, 'force-dynamic');
      const headers = new Headers({ cookie: 'offline-browser-owner=other', 'x-worker-secret': 'offline-worker-secret' });
      const authorization = Object.hasOwn(options, 'authorization') ? options.authorization : `Bearer ${accessToken}`;
      if (authorization !== null) headers.set('authorization', authorization);
      return route[method]({ headers, async json() {
        bodyReads++;
        if (options.bodyThrows) throw new Error(privateMarker);
        return body;
      } }, { params: Promise.resolve({ id }) });
    },
  };
}

async function check(response, status, fixture, expected) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('set-cookie'), null);
  const body = await response.json();
  if (expected) assert.deepEqual(body, expected);
  const serialized = JSON.stringify(body);
  for (const privateValue of [accessToken, privateMarker, oldHash, newHash, 'offline-new-password', fixtureEnv.SUPABASE_SERVICE_ROLE_KEY]) {
    assert.ok(!serialized.includes(privateValue), 'Responses never include passwords, hashes, raw errors or credentials');
  }
  assert.deepEqual(fixture.output, [], 'No private values may be logged');
  assert.equal(fixture.cookieReads, 0); assert.equal(fixture.ambientReads, 0);
  return body;
}

test('GET returns only reviewed settings, opaque lowercase revision and private/no-store', async () => {
  const f = harness({ row: defaultRow({ is_password_protected: true, password_hash: oldHash }) });
  const body = await check(await f.request(), 200, f);
  assert.deepEqual(Object.keys(body), ['settings']);
  assert.deepEqual(Object.keys(body.settings).sort(), ['albumId', 'allowDownload', 'downloadSize', 'isPasswordProtected', 'revision'].sort());
  assert.equal(body.settings.albumId, albumId);
  assert.equal(body.settings.isPasswordProtected, true);
  assert.match(body.settings.revision, /^[0-9a-f]{64}$/);
  assert.equal(f.bodyReads, 0); assert.equal(f.writes.length, 0);
  assert.deepEqual(f.clients[0][2].global.headers, { Authorization: `Bearer ${accessToken}` });
  assert.equal(f.clients[0][2].auth.persistSession, false);
});

for (const method of ['GET', 'PATCH']) {
  for (const authorization of [null, '', 'Bearer malformed', 'Bearer ciiya_sync_offline', 'Basic offline', 'Bearer a.b.c extra']) {
    test(`${method} rejects missing/malformed/non-user credentials before auth/body/DB`, async () => {
      const f = harness({ authorization });
      await check(await f.request(method, {}), 401, f, { error: 'Unauthorized' });
      assert.equal(f.clients.length, 0); assert.equal(f.authCalls, 0);
      assert.equal(f.bodyReads, 0); assert.equal(f.calls.length, 0);
    });
  }
  for (const options of [{ user: null }, { user: { id: 'invalid' } }, { authError: { message: privateMarker } }]) {
    test(`${method} rejects expired/invalid verified identity without DB/body`, async () => {
      const f = harness(options);
      await check(await f.request(method, {}), 401, f);
      assert.equal(f.calls.length, 0); assert.equal(f.bodyReads, 0);
    });
  }
  test(`${method} rejects invalid album UUID before private body/DB`, async () => {
    const f = harness();
    await check(await f.request(method, {}, '../private'), 404, f);
    assert.equal(f.calls.length, 0); assert.equal(f.bodyReads, 0);
  });
  for (const options of [
    { user: { id: otherOwnerId } }, { row: defaultRow({ status: 'deleted' }) },
    { row: defaultRow({ status: 'inactive' }) }, { row: null },
  ]) {
    test(`${method} refuses foreign/inactive/deleted/missing album before body`, async () => {
      const f = harness(options);
      await check(await f.request(method, {}), 404, f);
      assert.equal(f.bodyReads, 0); assert.equal(f.writes.length, 0);
    });
  }
}

test('Legacy null display defaults do not erase raw nulls in the revision or CAS', async () => {
  const f = harness({ row: defaultRow(Object.fromEntries(accessFields.map((field) => [field, null]))) });
  const { settings } = await check(await f.request(), 200, f);
  assert.equal(settings.allowDownload, true); assert.equal(settings.downloadSize, 'hd');
  assert.equal(settings.isPasswordProtected, false);
  assert.notEqual(settings.revision, f.helpers.albumAccessRevision(defaultRow()));
  await check(await f.request('PATCH', f.input()), 200, f, { success: true });
  for (const field of accessFields) assert.ok(f.writes[0].filters.some(([kind, name, value]) => kind === 'is' && name === field && value === null));
});

for (const override of [
  { allow_download: 'true' }, { allow_original_download: 1 }, { is_password_protected: undefined },
  { download_size: 'maximum' }, { password_hash: 'raw-password' }, { password_hash: '' },
]) {
  test('Corrupt access rows fail closed without leaking raw state', async () => {
    const f = harness({ row: defaultRow(override) });
    await check(await f.request(), 500, f);
    await check(await f.request('PATCH', {}), 500, f);
    assert.equal(f.bodyReads, 0); assert.equal(f.writes.length, 0);
  });
}

test('Revision includes every exact access field including password hash and album identity', () => {
  const { helpers } = harness();
  const baseline = defaultRow({ is_password_protected: true, password_hash: oldHash });
  const revision = helpers.albumAccessRevision(baseline);
  for (const change of [
    { allow_download: false }, { allow_original_download: true }, { download_size: 'uhd' },
    { is_password_protected: false }, { password_hash: newHash }, { id: otherAlbumId },
  ]) assert.notEqual(helpers.albumAccessRevision({ ...baseline, ...change }), revision);
});

const invalidBodies = [
  null, [], 'settings', {},
  { title: 'metadata forbidden' }, { shareToken: 'forbidden' }, { isPublic: true },
  { allowDownload: 'true' }, { isPasswordProtected: 1 }, { downloadSize: 'invalid' },
  { password: null }, { password: 'x'.repeat(73) }, { password: '😀'.repeat(19) },
  { password: 'ก'.repeat(25) }, { password: ' '.repeat(100_000) },
  { revision: 'a'.repeat(63) }, { revision: 'A'.repeat(64) }, { revision: '' },
];
for (const invalid of invalidBodies) {
  test('PATCH exact contract rejects invalid or expanded request before hash/write', async () => {
    const f = harness();
    const body = invalid && typeof invalid === 'object' && !Array.isArray(invalid)
      ? { ...f.input(), ...invalid } : invalid;
    // {} means an actually empty request, not a valid merge.
    await check(await f.request('PATCH', invalid && Object.keys(invalid).length === 0 ? invalid : body), 400, f);
    assert.equal(f.hashCalls.length, 0); assert.equal(f.writes.length, 0);
  });
}

test('PATCH rejects missing required property, extra mutation keys and non-plain request', async () => {
  for (const field of ['allowDownload', 'downloadSize', 'isPasswordProtected', 'password', 'revision']) {
    const f = harness(), body = f.input(); delete body[field];
    await check(await f.request('PATCH', body), 400, f); assert.equal(f.writes.length, 0);
  }
  const f = harness(), body = Object.assign(Object.create({ hidden: true }), f.input());
  await check(await f.request('PATCH', body), 400, f);
});

test('PATCH invalid JSON produces generic 400 without writing', async () => {
  const f = harness({ bodyThrows: true });
  await check(await f.request('PATCH', {}), 400, f); assert.equal(f.writes.length, 0);
});

test('PATCH accepts a validated uppercase album UUID but queries canonical lowercase ID', async () => {
  const f = harness(); await check(await f.request('PATCH', f.input(), albumId.toUpperCase()), 200, f);
});

for (const size of ['sd', 'hd', 'uhd', 'original']) {
  for (const allowDownload of [true, false]) {
    test(`Download permission/size ${allowDownload}/${size} preserves browser derived original permission`, async () => {
      const f = harness();
      await check(await f.request('PATCH', f.input({ allowDownload, downloadSize: size })), 200, f);
      assert.equal(f.row.allow_download, allowDownload); assert.equal(f.row.download_size, size);
      assert.equal(f.row.allow_original_download, allowDownload && size === 'original');
      assert.equal(f.row.password_hash, null); assert.equal(f.hashCalls.length, 0);
    });
  }
}

test('Enabling protection requires a new password even if a disabled album retains an old hash', async () => {
  for (const hash of [null, oldHash]) {
    const f = harness({ row: defaultRow({ password_hash: hash }) });
    await check(await f.request('PATCH', f.input({ isPasswordProtected: true })), 400, f);
    assert.equal(f.writes.length, 0); assert.equal(f.hashCalls.length, 0);
  }
});

test('Protected album with missing hash remains reviewable but requires new password to repair', async () => {
  const f = harness({ row: defaultRow({ is_password_protected: true, password_hash: null }) });
  const { settings } = await check(await f.request(), 200, f); assert.equal(settings.isPasswordProtected, true);
  await check(await f.request('PATCH', f.input({ isPasswordProtected: true })), 400, f);
  await check(await f.request('PATCH', f.input({ isPasswordProtected: true, password: 'offline-new-password' })), 200, f);
  assert.equal(f.row.password_hash, newHash);
});

test('Blank password keeps the exact existing hash only when already protected', async () => {
  const f = harness({ row: defaultRow({ is_password_protected: true, password_hash: oldHash }) });
  await check(await f.request('PATCH', f.input({ isPasswordProtected: true, password: '  ' })), 200, f);
  assert.equal(f.row.password_hash, oldHash); assert.equal(f.hashCalls.length, 0);
});

test('New and changed passwords are trimmed and bcrypt hashed with cost 10', async () => {
  for (const alreadyProtected of [false, true]) {
    const f = harness({ row: defaultRow({ is_password_protected: alreadyProtected, password_hash: alreadyProtected ? oldHash : null }) });
    await check(await f.request('PATCH', f.input({ isPasswordProtected: true, password: '  offline-new-password  ' })), 200, f);
    assert.deepEqual(f.hashCalls, [['offline-new-password', 10]]); assert.equal(f.row.password_hash, newHash);
  }
});

test('Disabling protection clears the hash and never hashes an unused password', async () => {
  const f = harness({ row: defaultRow({ is_password_protected: true, password_hash: oldHash }) });
  await check(await f.request('PATCH', f.input({ password: 'offline-new-password' })), 200, f);
  assert.equal(f.row.is_password_protected, false); assert.equal(f.row.password_hash, null); assert.equal(f.hashCalls.length, 0);
});

test('Exactly 72 UTF-8 password bytes are accepted for ASCII, Thai and emoji', async () => {
  for (const password of ['x'.repeat(72), 'ก'.repeat(24), '😀'.repeat(18)]) {
    const f = harness();
    await check(await f.request('PATCH', f.input({ isPasswordProtected: true, password })), 200, f);
    assert.equal(Buffer.byteLength(f.hashCalls[0][0], 'utf8'), 72);
  }
});

test('Actual installed bcrypt produces a valid cost-10 hash that verifies the trimmed secret', async () => {
  const f = harness({ realHash: true });
  await check(await f.request('PATCH', f.input({ isPasswordProtected: true, password: ' offline-new-password ' })), 200, f);
  assert.equal(bcrypt.getRounds(f.row.password_hash), 10);
  assert.equal(await bcrypt.compare('offline-new-password', f.row.password_hash), true);
});

test('Stale review revision refuses mutation before hash work, including password-only change', async () => {
  const f = harness({ row: defaultRow({ is_password_protected: true, password_hash: newHash }) });
  const stale = f.helpers.albumAccessRevision(defaultRow({ is_password_protected: true, password_hash: oldHash }));
  await check(await f.request('PATCH', f.input({ isPasswordProtected: true, password: 'offline-new-password', revision: stale })), 409, f);
  assert.equal(f.hashCalls.length, 0); assert.equal(f.writes.length, 0);
});

for (const race of [
  { allow_download: false }, { allow_original_download: true }, { download_size: 'original' },
  { is_password_protected: true }, { password_hash: newHash },
  { owner_id: otherOwnerId }, { status: 'deleted' },
]) {
  test('CAS detects each access/ownership/status change after reviewed read without phantom success', async () => {
    const f = harness({ updateRace: race });
    await check(await f.request('PATCH', f.input({ downloadSize: 'sd' })), 409, f);
    assert.notEqual(f.row.download_size, 'sd');
  });
}

test('Same-protection password change during bcrypt is a conflict, never overwritten', async () => {
  const f = harness({ row: defaultRow({ is_password_protected: true, password_hash: oldHash }), hashHook: { password_hash: newHash } });
  await check(await f.request('PATCH', f.input({ isPasswordProtected: true, password: 'offline-new-password' })), 409, f);
});

for (const updated of [null, {}, { id: otherAlbumId }]) {
  test('No confirmed exact update ID means 409, not success', async () => {
    const f = harness({ updated });
    await check(await f.request('PATCH', f.input()), 409, f);
  });
}

for (const options of [
  { clientThrows: true }, { authThrows: true }, { readThrows: true },
  { readError: { message: privateMarker } }, { updateThrows: true },
  { updateError: { message: privateMarker } }, { hashThrows: true }, { hashResult: 'raw-password' },
]) {
  test('Unexpected/auth/database/hash failures use generic private responses and no logs', async () => {
    const f = harness(options);
    const input = f.input({ isPasswordProtected: true, password: 'offline-new-password' });
    await check(await f.request('PATCH', input), 500, f);
  });
}

test('GET read failures and malformed returned IDs never reveal private errors', async () => {
  for (const options of [{ readThrows: true }, { readError: { message: privateMarker } }, { returnMalformed: defaultRow({ id: otherAlbumId }) }]) {
    const f = harness(options); await check(await f.request(), 500, f);
  }
});
