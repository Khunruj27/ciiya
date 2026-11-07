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
const photoId = '55555555-5555-4555-8555-555555555555';
const jobId = '77777777-7777-4777-8777-777777777777';
const originalPath = `${ownerId}/${albumId}/original/66666666-6666-4666-8666-666666666666.jpg`;
const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-offline.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'offline-admin-key',
};
const routePath = 'src/app/api/mobile/albums/[id]/photos/[photoId]/retry/route.ts';

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
  const noNetwork = () => { throw new Error('Offline retry tests must never use fetch'); };
  new Function('require', 'module', 'exports', 'process', 'fetch', compiled)(
    requireLocal, mod, mod.exports, { env }, noNetwork,
  );
  return mod.exports;
}

/** A tiny PostgREST stand-in that records every call and answers from fixtures. */
function fakeClient(kind, state) {
  return {
    auth: {
      async getUser() {
        assert.equal(kind, 'user', 'Identity is verified only with the user token client');
        state.authCalls++;
        return { data: { user: Object.hasOwn(state, 'user') ? state.user : { id: ownerId } }, error: state.authError || null };
      },
    },
    from(table) {
      const call = { kind, table, op: 'select', columns: null, filters: [], payload: null };
      state.calls.push(call);
      const q = {
        select(columns) { call.columns = columns; assert.ok(!columns.includes('*')); return q; },
        update(payload) { call.op = 'update'; call.payload = payload; return q; },
        insert(payload) { call.op = 'insert'; call.payload = payload; return q.then ? q : q; },
        eq(field, value) { call.filters.push(['eq', field, value]); return q; },
        in(field, values) { call.filters.push(['in', field, values]); return q; },
        delete() { throw new Error('Retry must never delete rows'); },
        async maybeSingle() { return state.answer(call); },
        then(resolve, reject) { return Promise.resolve(state.answer(call)).then(resolve, reject); },
      };
      return q;
    },
    rpc() { throw new Error('Retry must not call RPCs'); },
  };
}

function harness(options = {}) {
  const album = Object.hasOwn(options, 'album') ? options.album : { id: albumId, owner_id: ownerId, status: 'active' };
  const photo = Object.hasOwn(options, 'photo') ? options.photo : {
    id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'failed',
    original_path: originalPath, storage_path: originalPath, storage_provider: 'r2',
    storage_bucket: 'offline-media', preset_path: null, selected_size: 'uhd',
  };
  const job = Object.hasOwn(options, 'job') ? options.job : { id: jobId, status: 'failed', owner_id: ownerId, album_id: albumId };
  const state = {
    calls: [], authCalls: 0, clients: [], heads: [],
    ...(Object.hasOwn(options, 'user') ? { user: options.user } : {}),
    answer(call) {
      const has = (field, value) => call.filters.some(([, f, v]) => f === field && v === value);
      if (call.table === 'albums') {
        assert.equal(call.kind, 'user', 'Album ownership is read with the user client');
        const match = album && has('id', album.id) && has('owner_id', album.owner_id) && has('status', 'active');
        return { data: match ? { id: album.id } : null, error: null };
      }
      if (call.table === 'photos' && call.op === 'select') {
        assert.equal(call.kind, 'user', 'The photo is read with the user client');
        assert.ok(!/(url|password|token)/.test(call.columns), 'Never read URLs, passwords or tokens');
        const match = photo && has('id', photo.id) && has('album_id', photo.album_id) && has('owner_id', photo.owner_id);
        return { data: match ? { ...photo } : null, error: null };
      }
      if (call.table === 'photos' && call.op === 'update') {
        assert.equal(call.kind, 'admin');
        return { data: null, error: null };
      }
      if (call.table === 'photo_jobs' && call.op === 'select') {
        assert.equal(call.kind, 'admin');
        const raced = state.calls.some((c) => c.table === 'photo_jobs' && c.op === 'insert');
        if (raced && options.racedJob) return { data: options.racedJob, error: null };
        return { data: job ? { ...job } : null, error: null };
      }
      if (call.table === 'photo_jobs' && call.op === 'update') {
        return { data: Object.hasOwn(options, 'resetRow') ? options.resetRow : { id: jobId }, error: null };
      }
      if (call.table === 'photo_jobs' && call.op === 'insert') {
        return { data: null, error: options.insertError || null };
      }
      if (call.table === 'storage_assets') return { data: null, error: null };
      throw new Error(`Unexpected table access: ${call.table} ${call.op}`);
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/headers': {
      async headers() { throw new Error('Retry must not read ambient headers'); },
      cookies() { throw new Error('Retry must not read browser cookies'); },
    },
    '@supabase/supabase-js': {
      createClient(url, key, config) {
        const kind = key === env.SUPABASE_SERVICE_ROLE_KEY ? 'admin' : 'user';
        state.clients.push({ kind, auth: config?.global?.headers?.Authorization || null });
        return fakeClient(kind, state);
      },
    },
    '@/lib/rate-limit': {
      async rateLimit(_req, opts) {
        assert.equal(opts.identifier, ownerId, 'Rate limit is keyed to the verified owner');
        return { allowed: !options.rateLimited, remaining: 0, resetAt: Date.now(), limit: opts.limit };
      },
    },
    '@/lib/storage': {
      createStorageRef: (ref) => ref,
      getStorageAdapter: () => ({
        async objectExists(ref) {
          state.heads.push(ref);
          return { exists: options.originalExists !== false };
        },
      }),
      async resolvePresetStorageRef() { return options.presetRef || null; },
    },
  };
  const route = load(routePath, mocks);
  return { state, route };
}

async function call(h, { auth = 'Bearer offline.user.signature', id = albumId, photo = photoId } = {}) {
  const headers = new Headers();
  if (auth) headers.set('authorization', auth);
  const response = await h.route.POST({ headers }, { params: Promise.resolve({ id, photoId: photo }) });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

const writes = (state) => state.calls.filter((c) => c.op !== 'select');

test('missing or malformed credentials are rejected before any database work', async () => {
  for (const auth of [null, 'Basic abc', 'Bearer', `Bearer ciiya_sync_${'A'.repeat(43)}`]) {
    const h = harness();
    const r = await call(h, { auth });
    assert.equal(r.status, 401);
    assert.match(r.cache, /no-store/);
    assert.equal(h.state.calls.length, 0);
    assert.equal(h.state.authCalls, 0);
  }
});

test('an unverifiable token is 401 without reading albums or photos', async () => {
  const h = harness({ user: null });
  const r = await call(h);
  assert.equal(r.status, 401);
  assert.equal(h.state.calls.length, 0);
});

test('the user client carries only the token and the public key', async () => {
  const h = harness();
  await call(h);
  const user = h.state.clients.find((c) => c.kind === 'user');
  assert.equal(user.auth, 'Bearer offline.user.signature');
});

test('malformed IDs, foreign albums and photos from another album are 404 with no writes', async () => {
  for (const [opts, args] of [
    [{}, { id: 'not-a-uuid' }],
    [{}, { photo: '../etc' }],
    [{ album: { id: albumId, owner_id: otherOwnerId } }, {}],
    [{ photo: { id: photoId, album_id: otherAlbumId, owner_id: ownerId, processing_status: 'failed' } }, {}],
  ]) {
    const h = harness(opts);
    const r = await call(h, args);
    assert.equal(r.status, 404);
    assert.equal(writes(h.state).length, 0);
  }
});

test('a processed photo cannot be retried and nothing is written', async () => {
  const h = harness({ photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'done', original_path: originalPath } });
  const r = await call(h);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'NOT_RETRYABLE');
  assert.equal(writes(h.state).length, 0);
  assert.equal(h.state.clients.filter((c) => c.kind === 'admin').length, 0, 'No service-role client before a retry is allowed');
});

test('a photo already pending or processing is acknowledged without a second job', async () => {
  for (const status of ['pending', 'processing']) {
    const h = harness({ photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: status, original_path: originalPath } });
    const r = await call(h);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { success: true, retried: false, status });
    assert.equal(writes(h.state).length, 0);
  }
});

test('a failed photo resets its single job row with compare-and-set and keeps size, preset and paths', async () => {
  const h = harness();
  const r = await call(h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, retried: true, status: 'pending' });

  const reset = h.state.calls.find((c) => c.table === 'photo_jobs' && c.op === 'update');
  assert.equal(reset.kind, 'admin');
  assert.deepEqual(reset.filters, [['eq', 'id', jobId], ['eq', 'photo_id', photoId], ['eq', 'status', 'failed']]);
  assert.equal(reset.payload.status, 'pending');
  assert.equal(reset.payload.error, null);
  for (const field of ['size', 'preset_path', 'original_path', 'owner_id', 'album_id', 'photo_id']) {
    assert.ok(!Object.hasOwn(reset.payload, field), `A retry must not change ${field}`);
  }
  assert.ok(!h.state.calls.some((c) => c.op === 'insert'), 'One job row per photo: never insert beside an existing row');

  const photoUpdate = h.state.calls.find((c) => c.table === 'photos' && c.op === 'update');
  assert.equal(photoUpdate.payload.processing_status, 'pending');
  assert.deepEqual(photoUpdate.filters.find(([op]) => op === 'in'), ['in', 'processing_status', ['failed', 'cancelled']]);
  assert.ok(photoUpdate.filters.some(([, f, v]) => f === 'owner_id' && v === ownerId));
  // The reset happens before the photo is marked pending.
  assert.ok(h.state.calls.indexOf(reset) < h.state.calls.indexOf(photoUpdate));
});

test('a job the worker already holds is not reset', async () => {
  const h = harness({ job: { id: jobId, status: 'processing', owner_id: ownerId, album_id: albumId } });
  const r = await call(h);
  assert.deepEqual(r.body, { success: true, retried: false, status: 'processing' });
  assert.equal(writes(h.state).length, 0);
});

test('losing the compare-and-set race is a 409 and leaves the photo untouched', async () => {
  const h = harness({ resetRow: null });
  const r = await call(h);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'RETRY_CONFLICT');
  assert.ok(!h.state.calls.some((c) => c.table === 'photos' && c.op === 'update'));
});

test('a job row for another owner or album is never reset', async () => {
  const h = harness({ job: { id: jobId, status: 'failed', owner_id: otherOwnerId, album_id: albumId } });
  const r = await call(h);
  assert.equal(r.status, 500);
  assert.equal(writes(h.state).length, 0);
});

test('a missing original or an unsafe path stops the retry before any job write', async () => {
  const cases = [
    { originalExists: false },
    { photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'failed', original_path: `${otherOwnerId}/${albumId}/original/x.jpg`, storage_provider: 'r2', storage_bucket: 'b' } },
    { photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'failed', original_path: `${ownerId}/${albumId}/original/../x.jpg`, storage_provider: 'r2', storage_bucket: 'b' } },
    { photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'failed', original_path: originalPath, storage_provider: 'r2', storage_bucket: '' } },
    { photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'failed', original_path: originalPath, storage_provider: 'r2', storage_bucket: 'b', preset_path: `${ownerId}/${albumId}/presets/a.xmp` } },
  ];
  for (const opts of cases) {
    const h = harness(opts);
    const r = await call(h);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SOURCE_MISSING');
    assert.ok(!h.state.calls.some((c) => c.table === 'photo_jobs'), 'No queue access when the source is missing');
  }
});

test('a legacy photo without a job row gets exactly one, with its own size', async () => {
  const h = harness({ job: null });
  const r = await call(h);
  assert.equal(r.status, 200);
  const inserts = h.state.calls.filter((c) => c.op === 'insert');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].payload.size, 'uhd');
  assert.equal(inserts[0].payload.photo_id, photoId);
  assert.equal(inserts[0].payload.status, 'pending');
});

test('an insert that loses to a concurrent request is the same outcome, otherwise an error', async () => {
  const ok = harness({ job: null, insertError: { code: '23505' }, racedJob: { id: jobId, status: 'pending' } });
  assert.equal((await call(ok)).status, 200);
  const bad = harness({ job: null, insertError: { code: '23505' }, racedJob: { id: jobId, status: 'failed' } });
  const r = await call(bad);
  assert.equal(r.status, 500);
  assert.ok(!bad.state.calls.some((c) => c.table === 'photos' && c.op === 'update'));
});

test('rate limiting is per owner and answers before any photo read', async () => {
  const h = harness({ rateLimited: true });
  const r = await call(h);
  assert.equal(r.status, 429);
  assert.ok(!h.state.calls.some((c) => c.table === 'photos'));
});

test('error responses never include storage keys or identities', async () => {
  for (const opts of [{ originalExists: false }, { resetRow: null }, { job: null, insertError: { code: 'x' } }]) {
    const h = harness(opts);
    const r = await call(h);
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes(ownerId) && !text.includes(originalPath) && !text.includes(jobId));
  }
});
