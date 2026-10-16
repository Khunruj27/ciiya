/* global __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS harness uses installed tooling only. */
/*
 * Offline only: runs the real photo worker job code against an in-memory
 * database and object store (synthetic identities, real sharp). The worker's
 * polling loop is never started and nothing touches the network.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('../node_modules/typescript');
const sharp = require('../node_modules/sharp');

const root = path.resolve(__dirname, '..');
const ownerId = '11111111-1111-4111-8111-111111111111';
const albumId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const name = '55555555-5555-4555-8555-555555555555';
const bucket = 'offline-media';
const original = `${ownerId}/${albumId}/original/${name}.jpg`;
const presetPath = `${ownerId}/${albumId}/presets/${name}.xmp`;
const key = (folder, suffix = '') => `${ownerId}/${albumId}/${folder}/${name}${suffix}.jpg`;
const url = (k) => `https://cdn.offline.invalid/${k}`;
const PRESET = '<x:xmpmeta><rdf:Description crs:Exposure2012="+0.8" crs:Saturation="-40"/></x:xmpmeta>';

function compile(filename, source) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
}

function loadWorker(env) {
  const cache = new Map();
  const fakeProcess = { env, on() {}, exit() { throw new Error('The worker must not exit in tests'); }, memoryUsage: process.memoryUsage, pid: 1 };
  const load = (filename, source) => {
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const requireLocal = (specifier) => {
      if (Object.hasOwn(env.__mocks, specifier)) return env.__mocks[specifier];
      if (specifier === 'sharp') return sharp;
      if (specifier.startsWith('node:')) return require(specifier);
      if (!specifier.startsWith('.')) throw new Error(`Unmocked dependency: ${specifier}`);
      const resolved = path.resolve(path.dirname(filename), specifier);
      const file = fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : path.join(resolved, 'index.ts');
      return load(file, fs.readFileSync(file, 'utf8'));
    };
    const noNetwork = () => { throw new Error('Offline worker tests must never use fetch'); };
    new Function('require', 'module', 'exports', 'process', 'fetch', compile(filename, source))(
      requireLocal, mod, mod.exports, fakeProcess, noNetwork,
    );
    return mod.exports;
  };
  const workerFile = path.join(root, 'workers/photo-worker.ts');
  const source = fs.readFileSync(workerFile, 'utf8');
  const tail = source.lastIndexOf('start().catch(');
  assert.ok(tail > 0, 'The worker entry point moved; update this harness');
  return load(workerFile, `${source.slice(0, tail)}\nmodule.exports = { processPhotoJob, WORKER_ID }\n`);
}

/** In-memory PostgREST stand-in: eq/in filters, select/update/insert, single rows. */
function fakeDatabase(tables, hooks = {}) {
  const log = [];
  function from(table) {
    const rows = (tables[table] ||= []);
    const call = { table, op: 'select', payload: null, filters: [], returning: false };
    const matches = (row) => call.filters.every(([op, field, value]) =>
      op === 'eq' ? row[field] === value : op === 'in' ? value.includes(row[field]) : true);
    const run = () => {
      log.push(JSON.parse(JSON.stringify(call)));
      hooks.beforeQuery?.(call, tables);
      if (call.op === 'insert') {
        rows.push({ ...call.payload });
        return { data: call.returning ? [{ ...call.payload }] : null, error: null };
      }
      const hit = rows.filter(matches);
      if (call.op === 'update') {
        for (const row of hit) Object.assign(row, call.payload);
        return { data: call.returning ? hit.map((row) => ({ ...row })) : null, error: null };
      }
      return { data: hit.map((row) => ({ ...row })), error: null };
    };
    const q = {
      select() { if (call.op === 'select') call.op = 'select'; else call.returning = true; return q; },
      update(payload) { call.op = 'update'; call.payload = payload; return q; },
      insert(payload) { call.op = 'insert'; call.payload = payload; return q; },
      eq(field, value) { call.filters.push(['eq', field, value]); return q; },
      in(field, value) { call.filters.push(['in', field, value]); return q; },
      lt() { return q; }, gte() { return q; }, or() { return q; }, not() { return q; }, order() { return q; }, limit() { return q; },
      async maybeSingle() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      async single() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: null }; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    return q;
  }
  return { client: { from, rpc() { throw new Error('No RPCs in job processing'); } }, log };
}

function fakeStore(initial, hooks = {}) {
  const objects = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]));
  const id = (ref) => `${ref.bucket}|${ref.key}`;
  return {
    objects,
    has: (k) => objects.has(`${bucket}|${k}`),
    adapter: {
      async objectExists(ref) { return { exists: objects.has(id(ref)) }; },
      async downloadObject(ref) {
        if (!objects.has(id(ref))) throw new Error('Object not found');
        // Copies, as a network download would: the worker zeroes its buffers.
        return Buffer.from(objects.get(id(ref)));
      },
      async uploadObject(ref, body) { objects.set(id(ref), Buffer.from(body)); await hooks.afterUpload?.(ref); },
      async deleteObject(ref) { objects.delete(id(ref)); },
    },
  };
}

async function setup(options = {}) {
  const originalJpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 120, b: 160 } } })
    .jpeg().toBuffer();
  const store = fakeStore({
    ...(options.originalMissing ? {} : { [`${bucket}|${original}`]: originalJpeg }),
    [`${bucket}|${presetPath}`]: PRESET,
    [`${bucket}|${key('preview')}`]: 'old preview',
    [`${bucket}|${key('thumbnail')}`]: 'old thumbnail',
    [`${bucket}|${key('hd')}`]: 'old hd',
    [`${bucket}|${key('sd')}`]: 'old lazily generated sd',
  }, options.storeHooks);
  const photo = {
    id: photoId, album_id: albumId, owner_id: ownerId, user_id: ownerId,
    storage_provider: 'r2', storage_bucket: bucket, original_path: original, storage_path: key('preview'),
    preset_path: presetPath, processing_status: 'done', processing_progress: 100,
    preview_path: key('preview'), preview_url: url(key('preview')), public_url: url(key('preview')),
    thumbnail_path: key('thumbnail'), thumbnail_url: url(key('thumbnail')),
    hd_path: key('hd'), sd_path: key('sd'), uhd_path: null,
    face_scan_status: 'done', face_scan_progress: 100, faces_count: 3, ...options.photo,
  };
  const tables = {
    photos: [photo],
    photo_jobs: [{
      id: jobId, photo_id: photoId, album_id: albumId, owner_id: ownerId, original_path: original,
      preset_path: presetPath, size: 'hd', status: 'processing', retry_count: options.retryCount ?? 0,
      worker_id: null, claimed_by: null, payload: options.payload,
    }],
    face_jobs: [{ id: 'face-job', photo_id: photoId, owner_id: ownerId, album_id: albumId, status: 'done', image_path: key('preview'), image_url: url(key('preview')) }],
    albums: [{ id: albumId, owner_id: ownerId, cover_photo_id: photoId, cover_url: url(key('preview')) }],
  };
  const db = fakeDatabase(tables, options.dbHooks);
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-offline.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'offline-admin-key',
    FACE_SCAN_ENABLED: 'true',
    __mocks: {
      dotenv: { config() {} },
      ws: function OfflineWebSocket() {},
      '@supabase/supabase-js': { createClient: () => db.client },
      '../src/lib/storage': {
        createStorageRef: (ref) => ({ ...ref }),
        getStorageAdapter: () => store.adapter,
        resolvePublicStorageUrl: ({ key: k }) => url(k),
        async resolvePresetStorageRef({ presetPath: p }) { return { provider: 'r2', bucket, key: p }; },
      },
    },
  };
  const { processPhotoJob, WORKER_ID } = loadWorker(env);
  // claim_next_photo_job marks the row as held by this worker.
  Object.assign(tables.photo_jobs[0], { worker_id: WORKER_ID, claimed_by: WORKER_ID });
  return { processPhotoJob, store, tables, db };
}

async function runJob(h) {
  await h.processPhotoJob({ ...h.tables.photo_jobs[0] });
}

test('a reprocess renders new keys, keeps the photo visible and its faces, then removes the old render', async () => {
  const h = await setup({ payload: { source: 'owner-reprocess', reprocess: true, revision: 'abcdef1234' } });
  const photoUpdates = [];
  const from = h.db.client.from;
  h.db.client.from = (table) => {
    const q = from(table);
    if (table === 'photos') {
      const update = q.update;
      q.update = (payload) => { photoUpdates.push(payload); return update(payload); };
    }
    return q;
  };
  await runJob(h);

  const photo = h.tables.photos[0];
  for (const payload of photoUpdates) {
    assert.ok(!('processing_status' in payload) || payload.processing_status === 'done',
      `The photo never leaves done during a reprocess (saw ${payload.processing_status})`);
    assert.ok(!('faces_count' in payload) && !('face_scan_status' in payload), 'Faces are kept');
  }
  assert.equal(photo.processing_status, 'done');
  assert.equal(photo.preview_path, key('preview', '-abcdef1234'));
  assert.equal(photo.thumbnail_path, key('thumbnail', '-abcdef1234'));
  assert.equal(photo.hd_path, key('hd', '-abcdef1234'));
  assert.equal(photo.sd_path, null);
  assert.equal(photo.preview_url, url(key('preview', '-abcdef1234')));
  assert.equal(photo.faces_count, 3);
  assert.equal(photo.face_scan_status, 'done');

  // New render stored and actually re-encoded with the preset; old one gone; original kept.
  for (const k of [key('preview', '-abcdef1234'), key('thumbnail', '-abcdef1234'), key('hd', '-abcdef1234')]) {
    assert.ok(h.store.has(k), `${k} uploaded`);
  }
  const meta = await sharp(h.store.objects.get(`${bucket}|${key('thumbnail', '-abcdef1234')}`)).metadata();
  assert.equal(meta.format, 'jpeg');
  // The preset (+0.8 exposure) is baked in: brighter than the raw upload.
  const mean = async (buffer) => (await sharp(buffer).stats()).channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
  assert.ok(
    (await mean(h.store.objects.get(`${bucket}|${key('preview', '-abcdef1234')}`))) >
      (await mean(h.store.objects.get(`${bucket}|${original}`))) + 5,
    'The re-render applies the preset',
  );
  for (const k of [key('preview'), key('thumbnail'), key('hd'), key('sd')]) assert.ok(!h.store.has(k), `${k} removed`);
  assert.ok(h.store.has(original), 'The raw original is never removed');
  assert.ok(h.store.has(presetPath));

  assert.equal(h.tables.face_jobs[0].status, 'done', 'The face job is not re-run');
  assert.equal(h.tables.face_jobs[0].image_path, key('preview', '-abcdef1234'));
  assert.equal(h.tables.albums[0].cover_url, url(key('preview', '-abcdef1234')));
  assert.equal(h.tables.photo_jobs[0].status, 'done');
});

test('a reprocess that finally fails leaves the finished photo and its old render untouched', async () => {
  const h = await setup({
    payload: { source: 'owner-reprocess', reprocess: true, revision: 'abcdef1234' },
    retryCount: 3,
    // Fails after the new objects were uploaded: the commit itself errors.
    dbHooks: {
      beforeQuery(call) {
        if (call.table === 'photos' && call.op === 'update' && call.payload.preview_path) throw new Error('offline commit failure');
      },
    },
  });
  await runJob(h);
  const photo = h.tables.photos[0];
  assert.equal(photo.processing_status, 'done');
  assert.equal(photo.preview_path, key('preview'));
  assert.equal(photo.faces_count, 3);
  assert.equal(h.tables.photo_jobs[0].status, 'failed');
  for (const k of [key('preview'), key('thumbnail'), key('hd'), key('sd'), original]) assert.ok(h.store.has(k), `${k} kept`);
  for (const k of [key('preview', '-abcdef1234'), key('thumbnail', '-abcdef1234'), key('hd', '-abcdef1234')]) {
    assert.ok(!h.store.has(k), `${k} rolled back`);
  }
  assert.equal(h.tables.albums[0].cover_url, url(key('preview')));
});

test('a reprocess that will be retried keeps its uploads for the retry and the photo done', async () => {
  const h = await setup({
    payload: { source: 'owner-reprocess', reprocess: true, revision: 'abcdef1234' },
    retryCount: 0,
    dbHooks: {
      beforeQuery(call) {
        if (call.table === 'photos' && call.op === 'update' && call.payload.preview_path) throw new Error('offline commit failure');
      },
    },
  });
  await runJob(h);
  assert.equal(h.tables.photos[0].processing_status, 'done');
  assert.equal(h.tables.photo_jobs[0].status, 'pending');
  assert.ok(h.store.has(key('preview')), 'The old render stays until a commit');
});

test('a photo deleted while it was being rendered again leaves no new objects behind', async () => {
  let deleted = false;
  const h = await setup({
    payload: { source: 'owner-reprocess', reprocess: true, revision: 'abcdef1234' },
    storeHooks: {
      async afterUpload() {
        if (deleted) return;
        deleted = true;
        // delete_photo_complete removes the job and the photo rows.
        h.tables.photo_jobs.length = 0;
        h.tables.photos.length = 0;
      },
    },
  });
  await runJob(h);
  for (const k of [key('preview', '-abcdef1234'), key('thumbnail', '-abcdef1234'), key('hd', '-abcdef1234')]) {
    assert.ok(!h.store.has(k), `${k} removed after the photo was deleted`);
  }
});

test('a normal job (no reprocess payload) keeps its existing behaviour and keys', async () => {
  const h = await setup({ photo: { processing_status: 'pending', preview_path: null, thumbnail_path: null, hd_path: null, sd_path: null } });
  await runJob(h);
  const photo = h.tables.photos[0];
  assert.equal(photo.processing_status, 'done');
  assert.equal(photo.preview_path, key('preview'));
  assert.equal(photo.thumbnail_path, key('thumbnail'));
  // A normal render resets the face count and hands faces to the face job.
  assert.equal(photo.faces_count, 0);
  assert.equal(h.tables.albums[0].cover_url, url(key('preview')), 'Only a reprocess moves the cover');
});

test('a reprocess payload on a photo that is not finished is processed as a normal job', async () => {
  const h = await setup({
    payload: { source: 'owner-reprocess', reprocess: true, revision: 'abcdef1234' },
    photo: { processing_status: 'failed' },
  });
  await runJob(h);
  const photo = h.tables.photos[0];
  assert.equal(photo.processing_status, 'done');
  assert.equal(photo.preview_path, key('preview'), 'No revision outside a reprocess of a finished photo');
});
