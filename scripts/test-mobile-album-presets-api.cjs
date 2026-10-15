/* global __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS harness uses installed tooling only. */
/* Offline only: synthetic identities and fake DB/storage. No servers, environment files or real fetch/writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('../node_modules/typescript');

const root = path.resolve(__dirname, '..');
const ownerId = '11111111-1111-4111-8111-111111111111';
const otherOwnerId = '22222222-2222-4222-8222-222222222222';
const albumId = '33333333-3333-4333-8333-333333333333';
const otherAlbumId = '44444444-4444-4444-8444-444444444444';
const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-offline.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'offline-admin-key',
};
const routePath = 'src/app/api/mobile/albums/[id]/presets/route.ts';
const xmp = '<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>';

function load(relative, mocks, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = { exports: {} };
  cache.set(filename, mod);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const requireLocal = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    const resolved = specifier.startsWith('@/') ? path.resolve(root, 'src', specifier.slice(2)) : null;
    if (!resolved) throw new Error(`Unmocked dependency: ${specifier}`);
    return load(path.relative(root, `${resolved}.ts`), mocks, cache);
  };
  const noNetwork = () => { throw new Error('Offline preset tests must never use fetch'); };
  new Function('require', 'module', 'exports', 'process', 'fetch', 'crypto', compiled)(
    requireLocal, mod, mod.exports, { env }, noNetwork, { randomUUID: () => '66666666-6666-4666-8666-666666666666' },
  );
  return mod.exports;
}

function harness(options = {}) {
  const album = Object.hasOwn(options, 'album') ? options.album : { id: albumId, owner_id: ownerId, status: 'active' };
  const state = { calls: [], uploads: [], deletes: [], clients: [], bodyReads: 0, authCalls: 0 };
  const assets = options.assets ?? [
    { object_key: `${ownerId}/${albumId}/presets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.xmp`, original_name: '1700000000-Warm Film.xmp', created_at: '2026-10-15T01:00:00.000Z', secret: 'never-return' },
    { object_key: `${ownerId}/${otherAlbumId}/presets/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.xmp`, original_name: 'Other album.xmp', created_at: '2026-10-14T01:00:00.000Z' },
    { object_key: `${ownerId}/presets/legacy-one.xmp`, original_name: null, created_at: null },
    { object_key: `${ownerId}/${albumId}/presets/../escape.xmp`, original_name: 'bad', created_at: null },
    { object_key: `${ownerId}/${albumId}/presets/not-a-preset.jpg`, original_name: 'bad', created_at: null },
  ];
  const fakeClient = (kind) => ({
    auth: {
      async getUser() {
        state.authCalls++;
        return { data: { user: Object.hasOwn(options, 'user') ? options.user : { id: ownerId } }, error: null };
      },
    },
    from(table) {
      const call = { kind, table, op: 'select', filters: [], payload: null, columns: null };
      state.calls.push(call);
      const answer = () => {
        const has = (f, v) => call.filters.some(([, field, value]) => field === f && value === v);
        if (table === 'albums') {
          assert.equal(kind, 'user');
          return { data: album && has('id', album.id) && has('owner_id', album.owner_id) && has('status', 'active') ? { id: album.id } : null, error: null };
        }
        if (table === 'storage_assets' && call.op === 'select') {
          assert.equal(kind, 'user', 'Presets are listed with the user client');
          assert.ok(has('owner_id', ownerId) && has('asset_kind', 'preset') && has('status', 'active'));
          return { data: assets, error: options.listError || null };
        }
        if (table === 'storage_assets' && call.op === 'insert') {
          assert.equal(kind, 'admin', 'Registration uses the server-only client');
          return { data: options.insertFails ? null : { id: 'asset-1', created_at: '2026-10-15T02:00:00.000Z' }, error: options.insertFails ? { message: 'x' } : null };
        }
        throw new Error(`Unexpected ${table} ${call.op}`);
      };
      const q = {
        select(columns) { call.columns = columns; assert.ok(!columns.includes('*')); return q; },
        insert(payload) { call.op = 'insert'; call.payload = payload; return q; },
        update() { throw new Error('Preset routes never update rows'); },
        delete() { throw new Error('Preset routes never delete rows'); },
        eq(field, value) { call.filters.push(['eq', field, value]); return q; },
        order() { return q; },
        limit() { return q; },
        async maybeSingle() { return answer(); },
        async single() { return answer(); },
        then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject); },
      };
      return q;
    },
  });
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/headers': {
      async headers() { throw new Error('No ambient headers'); },
      cookies() { throw new Error('No browser cookies'); },
    },
    '@supabase/supabase-js': {
      createClient(url, key) {
        const kind = key === env.SUPABASE_SERVICE_ROLE_KEY ? 'admin' : 'user';
        state.clients.push(kind);
        return fakeClient(kind);
      },
    },
    '@/lib/rate-limit': { async rateLimit(_r, opts) { assert.equal(opts.identifier, ownerId); return { allowed: !options.rateLimited }; } },
    '@/lib/get-user-storage-plan': { async getUserStoragePlan(id) { assert.equal(id, ownerId); return { remainingBytes: options.remainingBytes ?? 10_000_000 }; } },
    '@/lib/storage': {
      createStorageRef: (ref) => ref,
      getStorageAssetTarget: (kind, id) => { assert.equal(kind, 'preset'); assert.equal(id, ownerId); return { provider: 'r2', bucket: 'offline-media' }; },
      presetObjectKey: ({ ownerId: o, albumId: a, objectId }) => `${o}/${a}/presets/${objectId}.xmp`,
      getStorageAdapter: () => ({
        async listObjects() {
          if (options.legacyThrows) throw new Error('legacy down');
          return { objects: [
            { ref: { key: `${ownerId}/presets/legacy-one.xmp` }, lastModified: new Date('2026-01-01T00:00:00Z') },
            { ref: { key: `${ownerId}/presets/legacy-two.xmp` }, lastModified: null },
            { ref: { key: `${otherOwnerId}/presets/foreign.xmp` }, lastModified: null },
          ] };
        },
        async uploadObject(ref, buffer, opts) { state.uploads.push({ ref, size: buffer.length, opts }); },
        async deleteObject(ref) { state.deletes.push(ref); },
      }),
    },
  };
  return { state, route: load(routePath, mocks) };
}

async function call(h, method, { auth = 'Bearer offline.user.signature', id = albumId, body } = {}) {
  const headers = new Headers();
  if (auth) headers.set('authorization', auth);
  const req = { headers, async json() { h.state.bodyReads++; if (body instanceof Error) throw body; return body; } };
  const response = await h.route[method](req, { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

test('missing or malformed credentials are 401 before any database, storage or body access', async () => {
  for (const method of ['GET', 'POST']) {
    for (const auth of [null, 'Basic x', 'Bearer', `Bearer ciiya_sync_${'A'.repeat(43)}`]) {
      const h = harness();
      const r = await call(h, method, { auth, body: { fileName: 'a.xmp', content: xmp } });
      assert.equal(r.status, 401);
      assert.match(r.cache, /no-store/);
      assert.equal(h.state.calls.length + h.state.uploads.length + h.state.bodyReads, 0);
    }
  }
});

test('malformed IDs and other owners\' albums are 404 without listing or uploading', async () => {
  for (const [opts, args] of [[{}, { id: 'nope' }], [{ album: { id: albumId, owner_id: otherOwnerId } }, {}]]) {
    for (const method of ['GET', 'POST']) {
      const h = harness(opts);
      const r = await call(h, method, { ...args, body: { fileName: 'a.xmp', content: xmp } });
      assert.equal(r.status, 404);
      assert.ok(!h.state.calls.some((c) => c.table === 'storage_assets'));
      assert.equal(h.state.uploads.length + h.state.bodyReads, 0);
    }
  }
});

test('the list offers only presets this album can upload with, deduplicated, with safe fields only', async () => {
  const h = harness();
  const r = await call(h, 'GET');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.presets.map((p) => p.path), [
    `${ownerId}/${albumId}/presets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.xmp`,
    `${ownerId}/presets/legacy-one.xmp`,
    `${ownerId}/presets/legacy-two.xmp`,
  ]);
  assert.equal(r.body.presets[0].name, 'Warm Film');
  for (const preset of r.body.presets) assert.deepEqual(Object.keys(preset).sort(), ['createdAt', 'name', 'path']);
});

test('a failing legacy inventory still returns registered presets', async () => {
  const h = harness({ legacyThrows: true });
  const r = await call(h, 'GET');
  assert.equal(r.status, 200);
  assert.equal(r.body.presets.length, 2);
});

test('upload bodies that are not exactly an .xmp packet up to 2 MB are refused before storage', async () => {
  const bad = [
    new Error('bad json'), null, [], 'text',
    { fileName: 'a.xmp' },
    { fileName: 'a.xmp', content: xmp, extra: 1 },
    { fileName: 'a.txt', content: xmp },
    { fileName: '', content: xmp },
    { fileName: `${'a'.repeat(260)}.xmp`, content: xmp },
    { fileName: 'a.xmp', content: '' },
    { fileName: 'a.xmp', content: 'not an xmp packet' },
    { fileName: 'a.xmp', content: `${xmp}\u0000` },
    { fileName: 'a.xmp', content: `<x:xmpmeta>${'a'.repeat(2 * 1024 * 1024)}</x:xmpmeta>` },
  ];
  for (const body of bad) {
    const h = harness();
    const r = await call(h, 'POST', { body });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'INVALID_PRESET');
    assert.equal(h.state.uploads.length, 0);
  }
});

test('a full storage quota refuses the preset without writing', async () => {
  const h = harness({ remainingBytes: 10 });
  const r = await call(h, 'POST', { body: { fileName: 'Warm.xmp', content: xmp } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'STORAGE_LIMIT_EXCEEDED');
  assert.equal(h.state.uploads.length, 0);
});

test('a valid preset is stored under this album and registered to it', async () => {
  const h = harness();
  const r = await call(h, 'POST', { body: { fileName: 'folder/Warm Film.xmp', content: xmp } });
  assert.equal(r.status, 201);
  const key = `${ownerId}/${albumId}/presets/66666666-6666-4666-8666-666666666666.xmp`;
  assert.deepEqual(r.body, { preset: { path: key, name: 'folder-Warm Film', createdAt: '2026-10-15T02:00:00.000Z' } });
  assert.equal(h.state.uploads.length, 1);
  assert.equal(h.state.uploads[0].ref.key, key);
  assert.equal(h.state.uploads[0].opts.upsert, false);
  const insert = h.state.calls.find((c) => c.op === 'insert');
  assert.equal(insert.payload.owner_id, ownerId);
  assert.equal(insert.payload.album_id, albumId);
  assert.equal(insert.payload.asset_kind, 'preset');
  assert.equal(insert.payload.object_key, key);
});

test('a stored object that cannot be registered is removed again', async () => {
  const h = harness({ insertFails: true });
  const r = await call(h, 'POST', { body: { fileName: 'Warm.xmp', content: xmp } });
  assert.equal(r.status, 500);
  assert.equal(h.state.deletes.length, 1);
  assert.equal(h.state.deletes[0].key, h.state.uploads[0].ref.key);
  assert.ok(!JSON.stringify(r.body).includes(ownerId));
});

test('upload rate limiting answers before the body is read', async () => {
  const h = harness({ rateLimited: true });
  const r = await call(h, 'POST', { body: { fileName: 'Warm.xmp', content: xmp } });
  assert.equal(r.status, 429);
  assert.equal(h.state.bodyReads, 0);
});
