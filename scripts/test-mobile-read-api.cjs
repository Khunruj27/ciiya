/* global __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline Node CommonJS harness loads installed tooling, not app bundle imports. */
/* Offline release tests: no environment files, servers, database writes or real fetch. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('../node_modules/typescript');
const sdk = require('../node_modules/@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const owner = '99999999-9999-4999-8999-999999999999';
const album = '22222222-2222-4222-8222-222222222222';
const foreignAlbum = '33333333-3333-4333-8333-333333333333';
const photo = '11111111-1111-4111-8111-111111111111';
const fixtureToken = 'offline.signature.fixture';
const fixtureEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-offline.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key',
};
const privateNoStore = 'private, no-store, max-age=0';
const routes = {
  list: 'src/app/api/mobile/albums/route.ts',
  detail: 'src/app/api/mobile/albums/[id]/route.ts',
  photos: 'src/app/api/mobile/albums/[id]/photos/route.ts',
};

function load(relative, mocks, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleUnderTest = { exports: {} };
  cache.set(filename, moduleUnderTest);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const requireLocal = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    const resolved = specifier.startsWith('@/')
      ? path.resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : null;
    if (!resolved) throw new Error(`Unmocked external dependency: ${specifier}`);
    return load(path.relative(root, `${resolved}.ts`), mocks, cache);
  };
  new Function('require', 'module', 'exports', 'process', 'console', compiled)(
    requireLocal, moduleUnderTest, moduleUnderTest.exports, { env: fixtureEnv },
    { error() {}, warn() {}, log() {} },
  );
  return moduleUnderTest.exports;
}

function database(albumRows = [], photoRows = [], failure = null) {
  const queries = [];
  const client = { from(table) {
    const call = { table, filters: [], columns: null, limit: Infinity, orders: [] };
    queries.push(call);
    const filters = [];
    const execute = (single = false) => {
      if (failure) return { data: null, error: { message: failure } };
      const source = table === 'albums' ? albumRows : photoRows;
      const rows = source.filter((row) => filters.every((filter) => filter(row))).slice(0, call.limit);
      return { data: single ? rows[0] || null : rows, error: null };
    };
    const query = {
      select(columns) { call.columns = columns; return query; },
      eq(field, value) { call.filters.push([field, value]); filters.push((row) => row[field] === value); return query; },
      in(field, values) { call.filters.push([field, values]); filters.push((row) => values.includes(row[field])); return query; },
      or(expression) {
        assert.equal(expression, 'status.is.null,status.neq.deleted');
        filters.push((row) => row.status == null || row.status !== 'deleted');
        return query;
      },
      order(field, options) { call.orders.push([field, options.ascending]); return query; },
      limit(value) { call.limit = value; return query; },
      async maybeSingle() { return execute(true); },
      then(resolve, reject) { return Promise.resolve().then(() => execute()).then(resolve, reject); },
    };
    return query;
  } };
  return { client, queries };
}

function harness({ authorization = `Bearer ${fixtureToken}`, user = { id: owner }, albums = [], photos = [], failure = null, createOverride } = {}) {
  const db = database(albums, photos, failure);
  const created = [];
  let cookieReads = 0, authReads = 0;
  const requestHeaders = new Headers({ cookie: 'browser-identity=never-consult-this' });
  if (authorization !== null) requestHeaders.set('authorization', authorization);
  const client = {
    ...db.client,
    auth: { async getUser() { authReads++; return { data: { user }, error: user ? null : { message: 'Unverifiable' } }; } },
  };
  const mocks = {
    'next/headers': {
      headers: async () => requestHeaders,
      cookies() { cookieReads++; throw new Error('Cookie fallback is forbidden'); },
    },
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    '@supabase/supabase-js': { createClient(...args) { created.push(args); return createOverride ? createOverride(...args) : client; } },
    '../storage/album-covers': { resolveAlbumCoverDeliveries: async (_client, rows) => rows },
    '../storage/delivery': { resolvePhotoDeliveries: (rows) => rows },
  };
  const cache = new Map();
  return {
    ...db, created,
    get cookieReads() { return cookieReads; }, get authReads() { return authReads; },
    helper: load('src/lib/mobile/server-client.ts', mocks, cache).createMobileSupabaseClient,
    async get(which, id = album, parameters = {}) {
      const { GET } = load(routes[which], mocks, cache);
      return GET({ nextUrl: new URL(`https://app-offline.invalid/?${new URLSearchParams(parameters)}`) }, { params: Promise.resolve({ id }) });
    },
  };
}

function albumRow(id = album, ownerId = owner, status = 'active') {
  return { id, owner_id: ownerId, title: 'Offline fixture', created_at: '2026-10-08T10:00:00Z', status, photo_count: 1 };
}
function photoRow(id = photo, ownerId = owner, albumId = album) {
  return { id, owner_id: ownerId, album_id: albumId, filename: 'fixture.jpg', created_at: '2026-10-08T10:00:00Z', processing_status: 'done', preview_url: 'https://images-offline.invalid/fixture.jpg' };
}

test('mobile helper rejects absent/malformed/Sync credentials despite browser cookies', async () => {
  for (const authorization of [null, '', 'Basic a.b.c', 'Bearer a.b', 'Bearer a.b.c.d', 'Bearer a.b.c extra', 'Bearer ciiya_sync_offline', 'a.b.c']) {
    const h = harness({ authorization });
    assert.equal(await h.helper(), null);
    assert.equal(h.created.length, 0);
    assert.equal(h.cookieReads, 0);
    assert.equal(h.authReads, 0);
    assert.equal(h.queries.length, 0);
  }
});

test('mobile helper builds a token-only anon-key client with no persistence or cookie access', async () => {
  const h = harness();
  assert.ok(await h.helper());
  assert.deepEqual(h.created, [[fixtureEnv.NEXT_PUBLIC_SUPABASE_URL, fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${fixtureToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }]]);
  assert.equal(h.cookieReads, 0);
  assert.equal(h.authReads, 0, 'Constructing the client must not assert an authenticated identity');
});

test('actual installed Supabase SDK validates the global bearer with wholly offline fetch', async () => {
  const calls = [];
  const h = harness({ createOverride: (url, key, options) => sdk.createClient(url, key, {
    ...options,
    global: { ...options.global, fetch: async (url, options) => {
      calls.push({ url: String(url), method: options.method, headers: new Headers(options.headers) });
      return new Response(JSON.stringify({ id: owner, aud: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json' } });
    } },
  }) });
  const client = await h.helper();
  const result = await client.auth.getUser();
  assert.equal(result.data.user.id, owner);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${fixtureEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.get('authorization'), `Bearer ${fixtureToken}`);
  assert.equal(calls[0].headers.get('apikey'), fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  assert.equal(calls[0].headers.get('cookie'), null);
});

for (const which of Object.keys(routes)) {
  test(`${which}: missing/malformed/unverifiable credentials return private401 before any data read`, async () => {
    for (const options of [{ authorization: null }, { authorization: 'Bearer ciiya_sync_offline' }, { user: null }]) {
      const h = harness(options);
      const response = await h.get(which);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), privateNoStore);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
      assert.equal(h.queries.length, 0);
      assert.equal(h.cookieReads, 0);
    }
  });
}

test('album list is explicit-column, owner-scoped and excludes deleted rows', async () => {
  const h = harness({ albums: [albumRow(), albumRow(foreignAlbum, 'another-owner'), albumRow('44444444-4444-4444-8444-444444444444', owner, 'deleted')] });
  const response = await h.get('list');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), privateNoStore);
  const payload = await response.json();
  assert.deepEqual(payload.albums.map((row) => row.id), [album]);
  assert.equal(payload.albums[0].owner_id, undefined);
  assert.equal(payload.albums[0].password_hash, undefined);
  assert.equal(h.authReads, 1);
  assert.deepEqual(h.queries[0].filters, [['owner_id', owner]]);
  assert.notEqual(h.queries[0].columns, '*');
  assert.ok(!h.queries[0].columns.includes('password_hash'));
});

test('foreign album is404 for detail/photos and never triggers a photo query', async () => {
  for (const which of ['detail', 'photos']) {
    const h = harness({ albums: [albumRow(album, 'another-owner')] });
    const response = await h.get(which);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), privateNoStore);
    assert.ok(h.queries.every((query) => query.table === 'albums'));
    assert.deepEqual(h.queries[0].filters, [['id', album], ['owner_id', owner]]);
  }
});

test('targeted photo reads remain scoped to validated album and authenticated owner', async () => {
  const foreignPhoto = '55555555-5555-4555-8555-555555555555';
  const h = harness({ albums: [albumRow()], photos: [photoRow(), photoRow(foreignPhoto, 'another-owner'), photoRow('66666666-6666-4666-8666-666666666666', owner, foreignAlbum)] });
  const response = await h.get('photos', album, { ids: [photo, foreignPhoto].join(',') });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), privateNoStore);
  const payload = await response.json();
  assert.deepEqual(payload.photos.map((row) => row.id), [photo]);
  assert.equal(payload.nextCursor, null);
  const query = h.queries.find((query) => query.table === 'photos');
  assert.deepEqual(query.filters.slice(0, 2), [['album_id', album], ['owner_id', owner]]);
  assert.equal(query.limit, 120);
  assert.notEqual(query.columns, '*');
  assert.equal(payload.photos[0].owner_id, undefined);
  assert.equal(payload.photos[0].original_url, undefined);
});

test('invalid album/cursor/ID batches are rejected with private cache headers before queries', async () => {
  const invalid = [
    ['detail', 'not-a-uuid', {}, 404],
    ['photos', 'not-a-uuid', {}, 404],
    ['photos', album, { cursor: '' }, 400],
    ['photos', album, { cursor: JSON.stringify({ createdAt: '2026-10-08T10:00:00Z', id: 'x),owner_id.eq.other' }) }, 400],
    ['photos', album, { ids: '' }, 400],
    ['photos', album, { ids: Array(121).fill(photo).join(',') }, 400],
    ['photos', album, { ids: photo, cursor: '2026-10-08T10:00:00Z' }, 400],
  ];
  for (const [which, id, parameters, status] of invalid) {
    const h = harness();
    const response = await h.get(which, id, parameters);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), privateNoStore);
    assert.equal(h.queries.length, 0);
  }
});

test('owner photo reads expose only allowlisted processing status and bounded worker progress', async () => {
  for (const [status, progress, expectedStatus, expectedProgress] of [
    ['processing', 34.5, 'processing', 35], ['processing', 100, 'processing', 100],
    ['processing', -1, 'processing', null], ['processing', 101, 'processing', null],
    ['processing', '20', 'processing', null], ['failed', 80, 'failed', null],
    ['pending', 50, 'pending', null], ['cancelled', 99, 'cancelled', null],
    [null, null, 'unknown', null], ['private-error-string', 80, 'unknown', null],
  ]) {
    const h = harness({ albums: [albumRow()], photos: [{ ...photoRow(),
      processing_status: status, processing_progress: progress,
      processing_error: 'private diagnostic', original_path: 'private original', password_hash: 'private hash' }] });
    const response = await h.get('photos');
    assert.equal(response.status, 200);
    const payload = await response.json();
    const row = payload.photos[0];
    assert.equal(row.processingStatus, expectedStatus);
    assert.equal(row.processingProgress, expectedProgress);
    assert.equal(row.isReady, false);
    const serialized = JSON.stringify(payload);
    for (const privateValue of ['private diagnostic', 'private original', 'private hash', 'private-error-string']) {
      assert.equal(serialized.includes(privateValue), false);
    }
    const query = h.queries.find(q => q.table === 'photos');
    assert.ok(query.columns.includes('processing_progress'));
    assert.ok(!query.columns.includes('processing_error'));
  }
});

test('all route query failures return generic private500 without leaking internals', async () => {
  for (const which of Object.keys(routes)) {
    const h = harness({ failure: 'Offline diagnostic internal detail' });
    const response = await h.get(which);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), privateNoStore);
    assert.ok(!(await response.text()).includes('Offline diagnostic internal detail'));
  }
});

test('mobile read routes use the dedicated helper and do not expose mutation methods', () => {
  for (const relative of Object.values(routes)) {
    const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
    assert.ok(source.includes('@/lib/mobile/server-client'));
    assert.ok(!source.includes('@/lib/supabase-server'));
    assert.ok(!/^export\s+(?:async\s+)?function\s+(POST|PATCH|PUT|DELETE)\b/m.test(source));
  }
});
