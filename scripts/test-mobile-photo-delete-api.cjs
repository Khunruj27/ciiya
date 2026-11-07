/* global __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS harness uses installed tooling only. */
/* Offline only: synthetic identities, fake DB and fake deletion jobs. No servers, environment files, real fetch or deletes. */
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
const photoId = '55555555-5555-4555-8555-555555555555';
const originalPath = `${ownerId}/${albumId}/original/66666666-6666-4666-8666-666666666666.jpg`;
const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-offline.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'offline-admin-key',
};
const routePath = 'src/app/api/mobile/albums/[id]/photos/[photoId]/route.ts';

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
  const noNetwork = () => { throw new Error('Offline delete tests must never use fetch'); };
  new Function('require', 'module', 'exports', 'process', 'fetch', compiled)(requireLocal, mod, mod.exports, { env }, noNetwork);
  return mod.exports;
}

function harness(options = {}) {
  const album = Object.hasOwn(options, 'album') ? options.album : { id: albumId, owner_id: ownerId, status: 'active' };
  const photo = Object.hasOwn(options, 'photo') ? options.photo : {
    id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'done',
    storage_provider: 'r2', storage_bucket: 'offline-media', storage_path: originalPath, original_path: originalPath,
    preview_path: `${ownerId}/${albumId}/preview/x.jpg`, thumbnail_path: null, sd_path: null, hd_path: null, uhd_path: null,
  };
  const state = { calls: [], rpcs: [], steps: [], clients: [], authCalls: 0 };
  const fakeClient = (kind) => ({
    auth: {
      async getUser() {
        assert.equal(kind, 'user');
        state.authCalls++;
        return { data: { user: Object.hasOwn(options, 'user') ? options.user : { id: ownerId } }, error: null };
      },
    },
    from(table) {
      const call = { kind, table, filters: [], columns: null };
      state.calls.push(call);
      const answer = () => {
        assert.equal(kind, 'user', 'Album and photo are read only with the user client');
        const has = (f, v) => call.filters.some(([field, value]) => field === f && value === v);
        if (table === 'albums') {
          return { data: album && has('id', album.id) && has('owner_id', album.owner_id) && has('status', 'active') ? { id: album.id } : null, error: null };
        }
        if (table === 'photos') {
          assert.ok(!/(url|password|token)/.test(call.columns), 'Never read URLs, passwords or tokens');
          const match = photo && has('id', photo.id) && has('album_id', photo.album_id) && has('owner_id', photo.owner_id);
          return { data: match ? { ...photo } : null, error: null };
        }
        throw new Error(`Unexpected table ${table}`);
      };
      const q = {
        select(columns) { call.columns = columns; assert.ok(!columns.includes('*')); return q; },
        eq(field, value) { call.filters.push([field, value]); return q; },
        update() { throw new Error('The route never updates rows directly'); },
        insert() { throw new Error('The route never inserts rows directly'); },
        delete() { throw new Error('Rows are deleted only by delete_photo_complete'); },
        async maybeSingle() { return answer(); },
      };
      return q;
    },
    async rpc(name, args) {
      assert.equal(kind, 'admin', 'RPCs run with the server-only client');
      state.rpcs.push({ name, args });
      state.steps.push(`rpc:${name}`);
      if (name === 'delete_photo_complete' && options.rpcFails) return { data: null, error: { message: 'x' } };
      return { data: null, error: null };
    },
  });
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/headers': {
      async headers() { throw new Error('No ambient headers'); },
      cookies() { throw new Error('No browser cookies'); },
    },
    'node:crypto': { randomUUID: () => 'offline-worker' },
    '@supabase/supabase-js': {
      createClient(url, key) {
        const kind = key === env.SUPABASE_SERVICE_ROLE_KEY ? 'admin' : 'user';
        state.clients.push(kind);
        return fakeClient(kind);
      },
    },
    '@/lib/rate-limit': { async rateLimit(_r, opts) { assert.equal(opts.identifier, ownerId); return { allowed: !options.rateLimited }; } },
    '@/lib/storage/deletion-jobs': {
      buildPhotoDeletionTargets({ photo: p, ownerId: o, albumId: a }) {
        if (options.badPaths) throw new Error('path outside album');
        assert.equal(o, ownerId); assert.equal(a, albumId); assert.equal(p.id, photoId);
        return [{ ref: { key: originalPath } }, { ref: { key: 'preview' } }];
      },
      async stageStorageDeletionJobs(args) { state.steps.push('stage'); assert.equal(args.ownerId, ownerId); return { operationId: 'op-1', staged: args.targets.length }; },
      async discardStagedStorageDeletionOperation(_s, op) { state.steps.push(`discard:${op}`); },
      async activateStorageDeletionOperation(_s, op) { state.steps.push(`activate:${op}`); if (options.activateThrows) throw new Error('x'); },
      async processStorageDeletionJobs(args) { state.steps.push(`process:${args.operationId}`); return { claimed: 2, completed: options.completed ?? 2, failed: 0 }; },
    },
  };
  return { state, route: load(routePath, mocks) };
}

async function call(h, { auth = 'Bearer offline.user.signature', id = albumId, photo = photoId } = {}) {
  const headers = new Headers();
  if (auth) headers.set('authorization', auth);
  const response = await h.route.DELETE({ headers }, { params: Promise.resolve({ id, photoId: photo }) });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

test('missing or malformed credentials are 401 before any database or deletion work', async () => {
  for (const auth of [null, 'Basic x', 'Bearer', `Bearer ciiya_sync_${'A'.repeat(43)}`]) {
    const h = harness();
    const r = await call(h, { auth });
    assert.equal(r.status, 401);
    assert.match(r.cache, /no-store/);
    assert.equal(h.state.calls.length + h.state.steps.length + h.state.authCalls, 0);
  }
});

test('an unverifiable token is 401 without reading albums or photos', async () => {
  const h = harness({ user: null });
  assert.equal((await call(h)).status, 401);
  assert.equal(h.state.calls.length, 0);
});

test('malformed IDs, foreign albums, photos from another album and missing photos are 404 with nothing deleted', async () => {
  for (const [opts, args] of [
    [{}, { id: 'x' }], [{}, { photo: '../x' }],
    [{ album: { id: albumId, owner_id: otherOwnerId } }, {}],
    [{ photo: { id: photoId, album_id: otherAlbumId, owner_id: ownerId, processing_status: 'done' } }, {}],
    [{ photo: null }, {}],
  ]) {
    const h = harness(opts);
    const r = await call(h, args);
    assert.equal(r.status, 404);
    assert.equal(h.state.steps.length, 0);
    assert.ok(!h.state.clients.includes('admin'), 'No service-role client before ownership is confirmed');
  }
});

test('a photo still processing is refused so no new previews are orphaned', async () => {
  for (const status of ['pending', 'processing', 'uploading', 'finalizing']) {
    const h = harness({ photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: status, original_path: originalPath } });
    const r = await call(h);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'PHOTO_PROCESSING');
    assert.equal(h.state.steps.length, 0);
  }
});

test('a finished or failed photo is staged, deleted in one locked RPC, then storage is cleaned in that order', async () => {
  for (const status of ['done', 'failed', 'cancelled', null]) {
    const h = harness({ photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: status, storage_provider: 'r2', storage_bucket: 'b', original_path: originalPath } });
    const r = await call(h);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { success: true, cleanupPending: false });
    assert.deepEqual(h.state.steps, ['stage', 'rpc:delete_photo_complete', 'activate:op-1', 'process:op-1', 'rpc:recalculate_user_storage']);
    assert.deepEqual(h.state.rpcs[0].args, { target_photo_id: photoId, target_owner_id: ownerId });
  }
});

test('if the database deletion fails, staged storage jobs are discarded and nothing is activated', async () => {
  const h = harness({ rpcFails: true });
  const r = await call(h);
  assert.equal(r.status, 500);
  assert.deepEqual(h.state.steps, ['stage', 'rpc:delete_photo_complete', 'discard:op-1']);
});

test('invalid storage paths are refused before staging or deleting anything', async () => {
  const h = harness({ badPaths: true });
  const r = await call(h);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'INVALID_STORAGE');
  assert.equal(h.state.steps.length, 0);
});

test('storage cleanup that cannot finish now is reported as pending, never as a failed deletion', async () => {
  const partial = harness({ completed: 1 });
  assert.deepEqual((await call(partial)).body, { success: true, cleanupPending: true });
  const thrown = harness({ activateThrows: true });
  const r = await call(thrown);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, cleanupPending: true });
});

test('rate limiting answers before any photo read; errors expose no keys or identities', async () => {
  const limited = harness({ rateLimited: true });
  assert.equal((await call(limited)).status, 429);
  assert.ok(!limited.state.calls.some((c) => c.table === 'photos'));
  for (const opts of [{ rpcFails: true }, { badPaths: true }]) {
    const text = JSON.stringify((await call(harness(opts))).body);
    assert.ok(!text.includes(ownerId) && !text.includes(originalPath));
  }
});
