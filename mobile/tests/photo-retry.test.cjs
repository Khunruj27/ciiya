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
    '@/lib/photo-retry-release': { photoRetryReleaseEnabled: enabled },
    '@/lib/preset-release': { presetReleaseEnabled: false, isPresetPickingAvailable: () => false },
    '@/lib/photo-delete-release': { photoDeleteReleaseEnabled: false, isPhotoDeleteAvailable: () => false },
    '@/lib/photo-reprocess-release': { photoReprocessReleaseEnabled: false, isPhotoReprocessAvailable: () => false },
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
      return send ? send(url, init) : response(200, { success: true, retried: true, status: 'pending' });
    },
  });
  return { liveData: exports.liveData, timers, requests, authCalls };
}

function loadRunner() {
  const exports = {};
  vm.runInNewContext(transpile('photo-retry.ts'), {
    exports, Promise, Error, Set,
    require(name) {
      assert.equal(name, '@/lib/data/types');
      return types;
    },
  });
  return exports;
}

function loadFeed() {
  const exports = {};
  vm.runInNewContext(transpile('data/photo-feed.ts'), {
    exports, Promise, Error, Set, Map,
    require(name) {
      assert.equal(name, './types');
      return types;
    },
  });
  return exports;
}

const photo = (id, processingStatus, isReady = false) => ({
  id, filename: `${id}.jpg`, thumbnailUrl: null, previewUrl: null, blurDataUrl: null,
  width: null, height: null, isReady, processingStatus, processingProgress: null, createdAt: '2026-10-15T00:00:00.000Z',
});

test('the retry release gate is open in source and independent of environment values', () => {
  for (const isDemoMode of [false, true]) {
    const exports = {};
    vm.runInNewContext(transpile('photo-retry-release.ts'), {
      exports, require(name) { assert.equal(name, '@/lib/config'); return { isDemoMode }; },
    });
    assert.equal(exports.photoRetryReleaseEnabled, true);
    assert.equal(exports.isPhotoRetryAvailable(), true);
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/photo-retry-release.ts'), 'utf8');
  assert.doesNotMatch(source, /process\.env|fetch\(|getSession\(/);
});

test('a closed gate refuses before token lookup, network or timers', async () => {
  const h = liveHarness({ enabled: false });
  await assert.rejects(h.liveData.retryPhotoProcessing('album', 'photo'), { kind: 'server' });
  assert.equal(h.authCalls.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('an enabled retry posts once to the encoded owner route with the bearer token and an empty body', async () => {
  const h = liveHarness();
  assert.equal(await h.liveData.retryPhotoProcessing('album/x', 'photo?y'), 'queued');
  assert.equal(h.requests.length, 1);
  const [request] = h.requests;
  assert.equal(request.url, 'https://mock.invalid/api/mobile/albums/album%2Fx/photos/photo%3Fy/retry');
  assert.equal(request.method, 'POST');
  assert.equal(request.body, '{}');
  assert.equal(request.headers.Authorization, 'Bearer mock-token');
  assert.equal(h.timers.size, 0, 'The request deadline is cleared once settled');
});

test('server answers map to typed outcomes; unknown or malformed answers are errors', async () => {
  const cases = [
    [response(200, { success: true, retried: true, status: 'pending' }), 'queued'],
    [response(200, { success: true, retried: false, status: 'processing' }), 'already-queued'],
    [response(409, { error: 'x', code: 'SOURCE_MISSING' }), 'source-missing'],
    [response(409, { error: 'x', code: 'NOT_RETRYABLE' }), 'not-retryable'],
  ];
  for (const [answer, expected] of cases) {
    const h = liveHarness({ send: () => answer });
    assert.equal(await h.liveData.retryPhotoProcessing('a', 'p'), expected);
  }
  const errors = [
    [response(409, { error: 'x', code: 'RETRY_CONFLICT' }), 'conflict'],
    [response(409, { error: 'x', code: 'SOMETHING_ELSE' }), 'server'],
    [response(200, { success: true }), 'server'],
    [response(200, { success: 'true', retried: true }), 'server'],
    [response(401, {}), 'unauthenticated'],
    [response(404, {}), 'server'],
    [response(429, { error: 'slow down' }), 'server'],
    [response(500, { error: 'boom' }), 'server'],
  ];
  for (const [answer, kind] of errors) {
    const h = liveHarness({ send: () => answer });
    await assert.rejects(h.liveData.retryPhotoProcessing('a', 'p'), { kind });
  }
});

test('empty IDs never reach the network', async () => {
  const h = liveHarness();
  await assert.rejects(h.liveData.retryPhotoProcessing('', 'p'), { kind: 'server' });
  await assert.rejects(h.liveData.retryPhotoProcessing('a', ''), { kind: 'server' });
  assert.equal(h.requests.length, 0);
});

test('only loaded failed or stopped photos are offered, never ready or in-progress ones', () => {
  const { retryablePhotos } = loadRunner();
  const picked = retryablePhotos([
    photo('a', 'failed'), photo('b', 'cancelled'), photo('c', 'pending'), photo('d', 'processing'),
    photo('e', 'done', true), photo('f', 'failed', true), photo('g', undefined),
  ]).map((value) => value.id);
  assert.deepEqual(picked, ['a', 'b']);
});

test('the batch is sequential, deduplicated, capped and counts each outcome', async () => {
  const { retryPhotos, MAX_PHOTO_RETRIES_PER_TAP } = loadRunner();
  let inFlight = 0, maxInFlight = 0;
  const sent = [];
  const outcomes = { a: 'queued', b: 'already-queued', c: 'source-missing', d: 'not-retryable' };
  const ids = ['a', 'b', 'a', 'c', 'd', ...Array.from({ length: 60 }, (_, i) => `x${i}`)];
  const progress = [];
  const summary = await retryPhotos({
    photoIds: ids,
    isCurrent: () => true,
    onProgress: (done, total) => progress.push([done, total]),
    async retry(id) {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      sent.push(id);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return outcomes[id] ?? 'queued';
    },
  });
  assert.equal(maxInFlight, 1, 'Never more than one request at a time');
  assert.equal(sent.length, MAX_PHOTO_RETRIES_PER_TAP);
  assert.equal(new Set(sent).size, sent.length);
  assert.equal(summary.alreadyQueued, 1);
  assert.equal(summary.sourceMissing, 1);
  assert.equal(summary.notRetryable, 1);
  assert.equal(summary.queued.length, MAX_PHOTO_RETRIES_PER_TAP - 3);
  assert.equal(summary.stopped, false);
  assert.deepEqual(progress.at(-1), [MAX_PHOTO_RETRIES_PER_TAP, MAX_PHOTO_RETRIES_PER_TAP]);
});

test('leaving the album or account stops the batch before the next request', async () => {
  const { retryPhotos } = loadRunner();
  let current = true;
  const sent = [];
  const summary = await retryPhotos({
    photoIds: ['a', 'b', 'c'],
    isCurrent: () => current,
    async retry(id) { sent.push(id); current = false; return 'queued'; },
  });
  assert.deepEqual(sent, ['a']);
  assert.equal(summary.stopped, true);
  assert.equal(summary.skipped, 2);
});

test('sign-out stops at once; repeated network failures stop after three; other errors continue', async () => {
  const { retryPhotos } = loadRunner();
  const signedOut = await retryPhotos({
    photoIds: ['a', 'b', 'c'], isCurrent: () => true,
    async retry() { throw new types.DataError('unauthenticated'); },
  });
  assert.equal(signedOut.failed, 1);
  assert.equal(signedOut.skipped, 2);
  assert.equal(signedOut.stopped, true);

  const offline = await retryPhotos({
    photoIds: ['a', 'b', 'c', 'd', 'e'], isCurrent: () => true,
    async retry() { throw new types.DataError('network'); },
  });
  assert.equal(offline.failed, 3);
  assert.equal(offline.skipped, 2);
  assert.equal(offline.stopped, true);

  let calls = 0;
  const mixed = await retryPhotos({
    photoIds: ['a', 'b', 'c'], isCurrent: () => true,
    async retry() { calls++; if (calls === 1) throw new types.DataError('conflict'); return 'queued'; },
  });
  assert.equal(mixed.failed, 1);
  assert.equal(mixed.queued.length, 2);
  assert.equal(mixed.stopped, false);
});

test('accepted retries show as waiting only for photos still failed or stopped here', async () => {
  const { PhotoFeed } = loadFeed();
  const page = { photos: [photo('a', 'failed'), photo('b', 'cancelled'), photo('c', 'done', true), photo('d', 'processing')], nextCursor: null };
  const feed = new PhotoFeed({ fetchPage: async () => page, fetchUpdates: async () => [] });
  await feed.reload();
  let published = 0;
  feed.subscribe(() => { published++; });
  feed.markRequeued(['a', 'b', 'c', 'd', 'missing']);
  const byId = Object.fromEntries(feed.getSnapshot().photos.map((value) => [value.id, value]));
  assert.equal(byId.a.processingStatus, 'pending');
  assert.equal(byId.b.processingStatus, 'pending');
  assert.equal(byId.c.processingStatus, 'done');
  assert.equal(byId.d.processingStatus, 'processing');
  assert.equal(published, 1);
  feed.markRequeued(['a']);
  assert.equal(published, 1, 'Nothing changes for photos already waiting');
  feed.dispose();
  feed.markRequeued(['x']);
});
