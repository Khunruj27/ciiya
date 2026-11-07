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
const routePath = 'src/app/api/mobile/albums/[id]/photos/[photoId]/reprocess/route.ts';

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
  const noNetwork = () => { throw new Error('Offline reprocess tests must never use fetch'); };
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
        delete() { throw new Error('Reprocess must never delete rows'); },
        async maybeSingle() { return state.answer(call); },
        then(resolve, reject) { return Promise.resolve(state.answer(call)).then(resolve, reject); },
      };
      return q;
    },
    rpc() { throw new Error('Reprocess must not call RPCs'); },
  };
}

function harness(options = {}) {
  const album = Object.hasOwn(options, 'album') ? options.album : { id: albumId, owner_id: ownerId, status: 'active' };
  const photo = Object.hasOwn(options, 'photo') ? options.photo : {
    id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'done',
    original_path: originalPath, storage_path: originalPath, storage_provider: 'r2',
    storage_bucket: 'offline-media', preset_path: null, selected_size: 'uhd',
  };
  const job = Object.hasOwn(options, 'job') ? options.job : { id: jobId, status: 'done', owner_id: ownerId, album_id: albumId };
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
        throw new Error('A reprocess must never change the finished photo row');
      }
      if (call.table === 'photo_jobs' && call.op === 'select') {
        assert.equal(call.kind, 'admin');
        const raced = state.calls.some((c) => c.table === 'photo_jobs' && c.op === 'insert');
        const reset = state.calls.some((c) => c.table === 'photo_jobs' && c.op === 'update');
        if ((raced || reset) && options.racedJob) return { data: options.racedJob, error: null };
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
      async headers() { throw new Error('Reprocess must not read ambient headers'); },
      cookies() { throw new Error('Reprocess must not read browser cookies'); },
    },
    'node:crypto': require('node:crypto'),
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
  mocks['./storage/paths'] = load('src/lib/storage/paths.ts', mocks);
  const route = load(routePath, mocks);
  return { state, route };
}

async function call(h, { auth = 'Bearer offline.user.signature', id = albumId, photo = photoId, body = '{}' } = {}) {
  const headers = new Headers();
  if (auth) headers.set('authorization', auth);
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await h.route.POST({ headers, async text() { return text; } }, { params: Promise.resolve({ id, photoId: photo }) });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

const writes = (state) => state.calls.filter((c) => c.op !== 'select');
const donePhoto = (extra = {}) => ({
  id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'done',
  original_path: originalPath, storage_path: originalPath, storage_provider: 'r2',
  storage_bucket: 'offline-media', preset_path: null, selected_size: 'hd', ...extra,
});

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

test('malformed IDs, foreign albums and photos from another album are 404 with no writes', async () => {
  for (const [opts, args] of [
    [{}, { id: 'not-a-uuid' }],
    [{}, { photo: '../etc' }],
    [{ album: { id: albumId, owner_id: otherOwnerId } }, {}],
    [{ photo: donePhoto({ album_id: otherAlbumId }) }, {}],
  ]) {
    const h = harness(opts);
    const r = await call(h, args);
    assert.equal(r.status, 404);
    assert.equal(writes(h.state).length, 0);
  }
});

test('a finished photo resets its single job row with a reprocess revision and leaves the photo row alone', async () => {
  const h = harness();
  const r = await call(h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, queued: true });

  const reset = h.state.calls.find((c) => c.table === 'photo_jobs' && c.op === 'update');
  assert.equal(reset.kind, 'admin');
  assert.deepEqual(reset.filters, [['eq', 'id', jobId], ['eq', 'photo_id', photoId], ['eq', 'status', 'done']]);
  assert.equal(reset.payload.status, 'pending');
  assert.equal(reset.payload.payload.source, 'owner-reprocess');
  assert.equal(reset.payload.payload.reprocess, true);
  assert.match(reset.payload.payload.revision, /^[a-z0-9]{8,16}$/);
  for (const field of ['size', 'preset_path', 'original_path', 'owner_id', 'album_id', 'photo_id']) {
    assert.ok(!Object.hasOwn(reset.payload, field), `A reprocess must not change ${field}`);
  }
  assert.ok(!h.state.calls.some((c) => c.op === 'insert'));
  // The harness throws on any photos update; reaching here proves none happened.
});

test('each request gets a fresh revision', async () => {
  const revisions = new Set();
  for (let i = 0; i < 5; i++) {
    const h = harness();
    await call(h);
    revisions.add(h.state.calls.find((c) => c.op === 'update').payload.payload.revision);
  }
  assert.equal(revisions.size, 5);
});

test('a photo that failed earlier and a failed reprocess job can both be queued again', async () => {
  const h = harness({ job: { id: jobId, status: 'failed', owner_id: ownerId, album_id: albumId } });
  const r = await call(h);
  assert.deepEqual(r.body, { success: true, queued: true });
});

test('only finished photos qualify; pending/processing are acknowledged, others refused, with no writes', async () => {
  for (const status of ['pending', 'processing']) {
    const h = harness({ photo: donePhoto({ processing_status: status }) });
    const r = await call(h);
    assert.deepEqual(r.body, { success: true, queued: false });
    assert.equal(writes(h.state).length, 0);
  }
  for (const status of ['failed', 'cancelled', 'uploading', null]) {
    const h = harness({ photo: donePhoto({ processing_status: status }) });
    const r = await call(h);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'NOT_REPROCESSABLE');
    assert.equal(writes(h.state).length, 0);
    assert.equal(h.state.clients.filter((c) => c.kind === 'admin').length, 0, 'No service-role client before a reprocess is allowed');
  }
});

test('a photo whose raw original was replaced by the baked image is refused (no double preset)', async () => {
  const baked = `${ownerId}/${albumId}/preview/66666666-6666-4666-8666-666666666666.jpg`;
  for (const original_path of [baked, `${ownerId}/${albumId}/hd/x.jpg`, `${otherOwnerId}/${albumId}/original/x.jpg`, null]) {
    const h = harness({ photo: donePhoto({ original_path, storage_path: original_path }) });
    const r = await call(h);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'NOT_REPROCESSABLE');
    assert.ok(!h.state.calls.some((c) => c.table === 'photo_jobs'));
  }
});

test('a missing original or preset stops the reprocess before any queue access', async () => {
  for (const opts of [
    { originalExists: false },
    { photo: donePhoto({ storage_bucket: '' }) },
    { photo: donePhoto({ preset_path: `${ownerId}/${albumId}/presets/a.xmp` }) },
  ]) {
    const h = harness(opts);
    const r = await call(h);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SOURCE_MISSING');
    assert.ok(!h.state.calls.some((c) => c.table === 'photo_jobs'));
  }
});

test('a job already queued or held by the worker is not reset', async () => {
  for (const status of ['pending', 'processing']) {
    const h = harness({ job: { id: jobId, status, owner_id: ownerId, album_id: albumId } });
    const r = await call(h);
    assert.deepEqual(r.body, { success: true, queued: false });
    assert.equal(writes(h.state).length, 0);
  }
});

test('losing the compare-and-set race to another queue is the same outcome; otherwise 409', async () => {
  const same = harness({ resetRow: null, racedJob: { id: jobId, status: 'pending' } });
  assert.deepEqual((await call(same)).body, { success: true, queued: false });
  const changed = harness({ resetRow: null, racedJob: { id: jobId, status: 'done' } });
  const r = await call(changed);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'RETRY_CONFLICT');
});

test('a job row for another owner or album is never reset', async () => {
  const h = harness({ job: { id: jobId, status: 'done', owner_id: otherOwnerId, album_id: albumId } });
  const r = await call(h);
  assert.equal(r.status, 500);
  assert.equal(writes(h.state).length, 0);
});

test('a legacy photo without a job row gets exactly one, carrying the reprocess payload', async () => {
  const h = harness({ job: null, photo: donePhoto({ selected_size: 'uhd' }) });
  const r = await call(h);
  assert.deepEqual(r.body, { success: true, queued: true });
  const inserts = h.state.calls.filter((c) => c.op === 'insert');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].payload.size, 'uhd');
  assert.equal(inserts[0].payload.original_path, originalPath);
  assert.equal(inserts[0].payload.payload.reprocess, true);
  const lost = harness({ job: null, insertError: { code: '23505' }, racedJob: { id: jobId, status: 'failed' } });
  assert.equal((await call(lost)).status, 500);
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

const albumPreset = `${ownerId}/${albumId}/presets/r6-outdoor.xmp`;
const accountPreset = `${ownerId}/presets/legacy.xmp`;

test('an empty or {} body keeps the photo preset and adds no preset to the job', async () => {
  for (const body of ['', '{}']) {
    const h = harness({ photo: donePhoto({ preset_path: albumPreset }), presetRef: { provider: 'r2', bucket: 'b', key: albumPreset } });
    const r = await call(h, { body });
    assert.deepEqual(r.body, { success: true, queued: true });
    const reset = h.state.calls.find((c) => c.op === 'update');
    assert.ok(!Object.hasOwn(reset.payload.payload, 'presetPath'));
  }
});

test('a chosen album or account preset travels in the job payload, never on the photo or job columns', async () => {
  for (const presetPath of [albumPreset, accountPreset]) {
    const h = harness({ presetRef: { provider: 'r2', bucket: 'b', key: presetPath } });
    const r = await call(h, { body: { presetPath } });
    assert.deepEqual(r.body, { success: true, queued: true });
    const reset = h.state.calls.find((c) => c.op === 'update');
    assert.equal(reset.payload.payload.presetPath, presetPath);
    assert.ok(!Object.hasOwn(reset.payload, 'preset_path'), 'The job column keeps the upload preset');
  }
});

test('presetPath null renders without a preset and skips the preset existence check', async () => {
  const h = harness({ photo: donePhoto({ preset_path: albumPreset }) });
  const r = await call(h, { body: { presetPath: null } });
  assert.deepEqual(r.body, { success: true, queued: true });
  assert.equal(h.state.calls.find((c) => c.op === 'update').payload.payload.presetPath, null);
});

test('a chosen preset that no longer exists is SOURCE_MISSING before any queue access', async () => {
  const h = harness();
  const r = await call(h, { body: { presetPath: albumPreset } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'SOURCE_MISSING');
  assert.ok(!h.state.calls.some((c) => c.table === 'photo_jobs'));
});

test('malformed bodies and presets from elsewhere are 400 before any database read', async () => {
  for (const body of [
    'not json', '[]', 'null', '"x"', { presetPath: 5 }, { presetPath: '' }, { other: 1 },
    { presetPath: albumPreset, extra: true },
    { presetPath: `${otherOwnerId}/presets/x.xmp` },
    { presetPath: `${ownerId}/${otherAlbumId}/presets/x.xmp` },
    { presetPath: `${ownerId}/${albumId}/presets/../x.xmp` },
    { presetPath: `${ownerId}/${albumId}/original/x.jpg` },
    `{"presetPath":"${'a'.repeat(3000)}"}`,
  ]) {
    const h = harness();
    const r = await call(h, { body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(r.body.code, 'INVALID_PRESET');
    assert.ok(!h.state.calls.some((c) => c.table === 'photos' || c.table === 'photo_jobs'));
  }
});

test('a Supabase original-size photo can be re-rendered only without a preset', async () => {
  const legacy = donePhoto({ storage_provider: 'supabase', storage_bucket: null, selected_size: 'original' });
  const refused = harness({ photo: legacy, presetRef: { provider: 'supabase', bucket: 'presets', key: albumPreset } });
  const r = await call(refused, { body: { presetPath: albumPreset } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'NOT_REPROCESSABLE');
  const allowed = harness({ photo: legacy });
  assert.deepEqual((await call(allowed, { body: { presetPath: null } })).body, { success: true, queued: true });
});
