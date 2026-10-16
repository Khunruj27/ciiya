/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function transpile(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const types = {};
vm.runInNewContext(transpile('data/types.ts'), { exports: types, Error });

function response(status, payload) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload };
}

// The real live datasource with fake auth/network/timers; the gate is a mock only.
function liveHarness({ enabled = true, send } = {}) {
  const timers = new Map(), requests = [], authCalls = [];
  let sequence = 0;
  const exports = {};
  const mocks = {
    '@/lib/config': { SITE_URL: 'https://mock.invalid' },
    '@/lib/album-edit-release': { albumEditReleaseEnabled: true },
    '@/lib/album-access-release': { albumAccessReleaseEnabled: true },
    '@/lib/photo-retry-release': { photoRetryReleaseEnabled: false },
    '@/lib/preset-release': { presetReleaseEnabled: false, isPresetPickingAvailable: () => false },
    '@/lib/photo-delete-release': { photoDeleteReleaseEnabled: false, isPhotoDeleteAvailable: () => false },
    '@/lib/photo-reprocess-release': { photoReprocessReleaseEnabled: enabled },
    '@/lib/supabase': { supabase: { auth: { getSession() {
      authCalls.push('getSession');
      return Promise.resolve({ data: { session: { access_token: 'mock-token', user: { id: 'owner' } } }, error: null });
    } } } },
    './types': types,
  };
  vm.runInNewContext(transpile('data/live.ts'), {
    exports, Promise, AbortController, Error, SyntaxError,
    require(name) {
      if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
      return mocks[name];
    },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, init) {
      requests.push({ url, ...init });
      return send ? send(url, init) : response(200, { success: true, queued: true });
    },
  });
  return { liveData: exports.liveData, timers, requests, authCalls };
}

function loadRunner() {
  const exports = {};
  vm.runInNewContext(transpile('photo-reprocess.ts'), {
    exports, Promise, Error, Set,
    require(name) { assert.equal(name, '@/lib/data/types'); return types; },
  });
  return exports;
}

function loadFeed() {
  const exports = {};
  vm.runInNewContext(transpile('data/photo-feed.ts'), {
    exports, Promise, Error, Set, Map, Date,
    require(name) { assert.equal(name, './types'); return types; },
  });
  return exports;
}

const photo = (id, processingStatus, isReady = false, url = `${id}-v1`) => ({
  id, filename: `${id}.jpg`, thumbnailUrl: `https://cdn.invalid/t/${url}.jpg`, previewUrl: `https://cdn.invalid/p/${url}.jpg`,
  blurDataUrl: null, width: null, height: null, isReady, processingStatus, processingProgress: null,
  createdAt: '2026-10-16T00:00:00.000Z',
});

test('the reprocess release gate is open in source and independent of environment values', () => {
  const exports = {};
  vm.runInNewContext(transpile('photo-reprocess-release.ts'), {
    exports, require(name) { assert.equal(name, '@/lib/config'); return { isDemoMode: false }; },
  });
  assert.equal(exports.photoReprocessReleaseEnabled, true);
  assert.equal(exports.isPhotoReprocessAvailable(), true);
  const demo = {};
  vm.runInNewContext(transpile('photo-reprocess-release.ts'), {
    exports: demo, require() { return { isDemoMode: true }; },
  });
  assert.equal(demo.isPhotoReprocessAvailable(), true);
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/photo-reprocess-release.ts'), 'utf8');
  assert.doesNotMatch(source, /process\.env|fetch\(|getSession\(/);
});

test('a closed gate refuses before token lookup, network or timers', async () => {
  const h = liveHarness({ enabled: false });
  await assert.rejects(h.liveData.reprocessPhoto('album', 'photo'), { kind: 'server' });
  assert.equal(h.authCalls.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('an enabled reprocess posts once to the encoded owner route with the bearer token and an empty body', async () => {
  const h = liveHarness();
  assert.equal(await h.liveData.reprocessPhoto('album/x', 'photo?y'), 'queued');
  assert.equal(h.requests.length, 1);
  const [request] = h.requests;
  assert.equal(request.url, 'https://mock.invalid/api/mobile/albums/album%2Fx/photos/photo%3Fy/reprocess');
  assert.equal(request.method, 'POST');
  assert.equal(request.body, '{}');
  assert.equal(request.headers.Authorization, 'Bearer mock-token');
  assert.equal(h.timers.size, 0, 'The request deadline is cleared once settled');
});

test('server answers map to typed outcomes; unknown or malformed answers are errors', async () => {
  for (const [answer, expected] of [
    [response(200, { success: true, queued: true }), 'queued'],
    [response(200, { success: true, queued: false }), 'already-queued'],
    [response(409, { error: 'x', code: 'SOURCE_MISSING' }), 'source-missing'],
    [response(409, { error: 'x', code: 'NOT_REPROCESSABLE' }), 'not-reprocessable'],
  ]) {
    const h = liveHarness({ send: () => answer });
    assert.equal(await h.liveData.reprocessPhoto('a', 'p'), expected);
  }
  for (const [answer, kind] of [
    [response(409, { error: 'x', code: 'RETRY_CONFLICT' }), 'conflict'],
    [response(409, { error: 'x', code: 'NOT_RETRYABLE' }), 'server'],
    [response(200, { success: true }), 'server'],
    [response(200, { success: true, retried: true }), 'server'],
    [response(200, { success: 'true', queued: true }), 'server'],
    [response(401, {}), 'unauthenticated'],
    [response(404, {}), 'server'],
    [response(429, { error: 'slow down' }), 'server'],
    [response(500, { error: 'boom' }), 'server'],
  ]) {
    const h = liveHarness({ send: () => answer });
    await assert.rejects(h.liveData.reprocessPhoto('a', 'p'), { kind });
  }
});

test('empty IDs never reach the network', async () => {
  const h = liveHarness();
  await assert.rejects(h.liveData.reprocessPhoto('', 'p'), { kind: 'server' });
  await assert.rejects(h.liveData.reprocessPhoto('a', ''), { kind: 'server' });
  assert.equal(h.requests.length, 0);
});

test('only finished photos can be processed again', () => {
  const { isPhotoReprocessable } = loadRunner();
  const cases = [
    [photo('a', 'done', true), true], [photo('b', 'done', false), false], [photo('c', 'failed'), false],
    [photo('d', 'pending'), false], [photo('e', 'processing'), false], [photo('f', 'cancelled'), false],
  ];
  for (const [value, expected] of cases) assert.equal(isPhotoReprocessable(value), expected, value.id);
});

test('the batch is sequential, deduplicated, capped and counts each outcome', async () => {
  const { reprocessPhotos, MAX_PHOTO_REPROCESS_PER_BATCH } = loadRunner();
  let inFlight = 0, maxInFlight = 0;
  const sent = [];
  const outcomes = { a: 'queued', b: 'already-queued', c: 'source-missing', d: 'not-reprocessable' };
  const ids = ['a', 'b', 'a', 'c', 'd', ...Array.from({ length: 120 }, (_, i) => `x${i}`)];
  const summary = await reprocessPhotos({
    photoIds: ids,
    isCurrent: () => true,
    async reprocess(id) {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      sent.push(id);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return outcomes[id] ?? 'queued';
    },
  });
  assert.equal(maxInFlight, 1);
  assert.equal(sent.length, MAX_PHOTO_REPROCESS_PER_BATCH);
  assert.equal(new Set(sent).size, sent.length);
  assert.equal(summary.alreadyQueued, 1);
  assert.equal(summary.sourceMissing, 1);
  assert.equal(summary.notReprocessable, 1);
  assert.equal(summary.queued.length, MAX_PHOTO_REPROCESS_PER_BATCH - 3);
});

test('sign-out and a dead connection stop the batch; leaving the album stops before the next send', async () => {
  const { reprocessPhotos } = loadRunner();
  const signedOut = await reprocessPhotos({
    photoIds: ['a', 'b', 'c'], isCurrent: () => true,
    async reprocess() { throw new types.DataError('unauthenticated'); },
  });
  assert.deepEqual([signedOut.failed, signedOut.skipped, signedOut.stopped], [1, 2, true]);
  const offline = await reprocessPhotos({
    photoIds: ['a', 'b', 'c', 'd', 'e'], isCurrent: () => true,
    async reprocess() { throw new types.DataError('network'); },
  });
  assert.deepEqual([offline.failed, offline.skipped, offline.stopped], [3, 2, true]);
  let current = true;
  const left = await reprocessPhotos({
    photoIds: ['a', 'b'], isCurrent: () => current,
    async reprocess() { current = false; return 'queued'; },
  });
  assert.deepEqual([[...left.queued], left.skipped, left.stopped], [['a'], 1, true]);
});

test('the feed watches reprocessing photos until their image URL changes, and polls them meanwhile', async () => {
  const { PhotoFeed } = loadFeed();
  let page = [photo('a', 'done', true), photo('b', 'done', true), photo('c', 'pending')];
  const asked = [];
  let updates = [];
  const feed = new PhotoFeed({
    async fetchPage() { return { photos: page, nextCursor: null }; },
    async fetchUpdates(ids) { asked.push([...ids]); return updates; },
  });
  await feed.reload();
  assert.deepEqual([...feed.getSnapshot().reprocessingIds], []);

  feed.markReprocessing(['a', 'c', 'missing']);
  assert.deepEqual([...feed.getSnapshot().reprocessingIds], ['a'], 'Only loaded, ready photos are watched');
  assert.equal(feed.getSnapshot().photos[0].isReady, true, 'A reprocessing photo stays visible');

  updates = [photo('a', 'done', true)];
  await feed.refreshProcessing();
  assert.deepEqual(asked.at(-1).sort(), ['a', 'c'], 'Processing and reprocessing photos are both polled');
  assert.deepEqual([...feed.getSnapshot().reprocessingIds], ['a'], 'Same URL: still waiting');

  updates = [photo('a', 'done', true, 'a-v2')];
  await feed.refreshProcessing();
  assert.deepEqual([...feed.getSnapshot().reprocessingIds], [], 'A new URL means the new render is in');
  assert.equal(feed.getSnapshot().photos[0].thumbnailUrl, 'https://cdn.invalid/t/a-v2.jpg');

  // A full refresh that already carries the new image settles it too.
  feed.markReprocessing(['b']);
  page = [photo('a', 'done', true, 'a-v2'), photo('b', 'done', true, 'b-v2'), photo('c', 'pending')];
  await feed.refreshLatest();
  assert.deepEqual([...feed.getSnapshot().reprocessingIds], []);
});

test('a reprocess watch ends when the photo is removed or after the watch window', async () => {
  const { PhotoFeed, REPROCESS_WATCH_MS } = loadFeed();
  let now = 1_000;
  const feed = new PhotoFeed({
    async fetchPage() { return { photos: [photo('a', 'done', true), photo('b', 'done', true)], nextCursor: null }; },
    async fetchUpdates() { return []; },
  }, () => now);
  await feed.reload();
  feed.markReprocessing(['a', 'b']);
  feed.removePhotos(['a']);
  assert.deepEqual([...feed.getSnapshot().reprocessingIds], ['b']);
  now += REPROCESS_WATCH_MS + 1;
  await feed.refreshProcessing();
  assert.deepEqual([...feed.getSnapshot().reprocessingIds], []);
});

test('the album screen confirms, fences repeats and never runs a reprocess beside a delete', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/(app)/(albums)/album/[id]/index.tsx'), 'utf8');
  assert.match(source, /t\.album\.reprocessTitle\(ids\.length\), t\.album\.reprocessMessage/);
  assert.match(source, /async function runReprocessSelected[\s\S]*?if \(!isCurrent\(\) \|\| reprocessingRef\.current \|\| deletingRef\.current\) return;/);
  assert.match(source, /feed\.markReprocessing\(summary\.queued\)/);
  assert.match(source, /isPhotoReprocessAvailable\(\) \? \(\s*<Pressable onPress=\{confirmReprocessSelected\}/);
  assert.match(source, /data\.reprocessPhoto\(id, photoId\)/);
});
