/* global __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS harness uses installed tooling only. */
/* Web album-grid retry route. Offline only: synthetic identities and fake DB/storage. No servers, environment files or real fetch/writes. */
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
const routePath = 'src/app/api/photos/retry-processing/route.ts';

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
        // The web route has only a photo ID; it scopes by the signed-in owner.
        const match = photo && has('id', photo.id) && has('owner_id', photo.owner_id);
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
    '@/lib/supabase-server': {
      async createServerSupabaseClient() {
        state.clients.push({ kind: 'user', auth: 'cookie' });
        return fakeClient('user', state);
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


async function call(h, body = { photoId }) {
  const response = await h.route.POST({ async json() { if (body instanceof Error) throw body; return body; } });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

const writes = (state) => state.calls.filter((c) => c.op !== 'select');

test('no session is 401 before any read', async () => {
  const h = harness({ user: null });
  const r = await call(h);
  assert.equal(r.status, 401);
  assert.equal(h.state.calls.length, 0);
});

test('malformed IDs are 400 without reading the photo', async () => {
  for (const body of [new Error('bad'), null, {}, { photoId: '../x' }, { photoId: 'x'.repeat(200) }]) {
    const h = harness();
    const r = await call(h, body);
    assert.equal(r.status, 400);
    assert.equal(h.state.calls.length, 0);
  }
});

test("another owner's photo is 404 and the photo is read with the user's client scoped to the owner", async () => {
  const h = harness({ photo: { id: photoId, album_id: albumId, owner_id: otherOwnerId, processing_status: 'failed' } });
  const r = await call(h);
  assert.equal(r.status, 404);
  const read = h.state.calls.find((c) => c.table === 'photos');
  assert.equal(read.kind, 'user');
  assert.ok(read.filters.some(([, f, v]) => f === 'owner_id' && v === ownerId));
  assert.equal(writes(h.state).length, 0);
  assert.ok(!h.state.clients.some((c) => c.kind === 'admin'));
});

test('a failed photo resets its existing job in place and never inserts a second one', async () => {
  const h = harness();
  const r = await call(h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, retried: true, status: 'pending', photoId });
  assert.match(r.cache, /no-store/);
  const reset = h.state.calls.find((c) => c.table === 'photo_jobs' && c.op === 'update');
  assert.deepEqual(reset.filters, [['eq', 'id', jobId], ['eq', 'photo_id', photoId], ['eq', 'status', 'failed']]);
  for (const field of ['size', 'preset_path', 'original_path']) assert.ok(!Object.hasOwn(reset.payload, field));
  assert.ok(!h.state.calls.some((c) => c.op === 'insert'), 'The old route inserted here and always hit uq_photo_jobs_photo_id');
  const photoUpdate = h.state.calls.find((c) => c.table === 'photos' && c.op === 'update');
  assert.deepEqual(photoUpdate.filters.find(([op]) => op === 'in'), ['in', 'processing_status', ['failed', 'cancelled']]);
});

test('pending/processing photos are acknowledged without writes; done photos are not reprocessed', async () => {
  for (const status of ['pending', 'processing']) {
    const h = harness({ photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: status, original_path: originalPath } });
    const r = await call(h);
    assert.deepEqual(r.body, { success: true, retried: false, photoId, status });
    assert.equal(writes(h.state).length, 0);
  }
  const done = harness({ photo: { id: photoId, album_id: albumId, owner_id: ownerId, processing_status: 'done', original_path: originalPath } });
  const r = await call(done);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'NOT_RETRYABLE');
  assert.equal(writes(done.state).length, 0);
});

test('a missing original stops before any queue access', async () => {
  const h = harness({ originalExists: false });
  const r = await call(h);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'SOURCE_MISSING');
  assert.ok(!h.state.calls.some((c) => c.table === 'photo_jobs'));
});

test('losing the compare-and-set race is 409 and errors expose no keys or identities', async () => {
  const h = harness({ resetRow: null });
  const r = await call(h);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'RETRY_CONFLICT');
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes(ownerId) && !text.includes(originalPath) && !text.includes(jobId));
});

test('the legacy /api/worker/retry route runs this same retry, not its old size/preset-changing upsert', () => {
  const source = fs.readFileSync(path.join(root, 'src/app/api/worker/retry/route.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(source, /export \{ POST \} from '@\/app\/api\/photos\/retry-processing\/route'/);
  assert.doesNotMatch(source, /upsert|insert|size:\s*'original'/);
});
