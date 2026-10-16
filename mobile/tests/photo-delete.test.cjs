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
const response = (status, payload) => ({ status, ok: status >= 200 && status < 300, json: async () => payload });

function liveHarness({ enabled = true, send } = {}) {
  const timers = new Map(), requests = [], authCalls = [];
  let sequence = 0;
  const exports = {};
  const mocks = {
    '@/lib/config': { SITE_URL: 'https://mock.invalid' },
    '@/lib/album-edit-release': { albumEditReleaseEnabled: true },
    '@/lib/album-access-release': { albumAccessReleaseEnabled: true },
    '@/lib/photo-retry-release': { photoRetryReleaseEnabled: true },
    '@/lib/preset-release': { presetReleaseEnabled: true },
    '@/lib/photo-delete-release': { photoDeleteReleaseEnabled: enabled },
    '@/lib/photo-reprocess-release': { photoReprocessReleaseEnabled: false },
    '@/lib/supabase': { supabase: { auth: { getSession() {
      authCalls.push('getSession');
      return Promise.resolve({ data: { session: { access_token: 'mock-token', user: { id: 'owner' } } }, error: null });
    } } } },
    './types': types,
  };
  vm.runInNewContext(transpile('data/live.ts'), {
    exports, Promise, AbortController, Error, SyntaxError,
    require(name) { if (!(name in mocks)) throw Error('Unmocked dependency: ' + name); return mocks[name]; },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, init) { requests.push({ url, ...init }); return send(url, init); },
  });
  return { liveData: exports.liveData, timers, requests, authCalls };
}

test('the delete release gate is open in source and independent of environment values', () => {
  for (const isDemoMode of [false, true]) {
    const exports = {};
    vm.runInNewContext(transpile('photo-delete-release.ts'), {
      exports, require(name) { assert.equal(name, '@/lib/config'); return { isDemoMode }; },
    });
    assert.equal(exports.photoDeleteReleaseEnabled, true);
    assert.equal(exports.isPhotoDeleteAvailable(), true);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/lib/photo-delete-release.ts'), 'utf8'), /process\.env|fetch\(|getSession\(/);
});

test('a closed gate refuses before token lookup, network or timers', async () => {
  const h = liveHarness({ enabled: false, send: () => { throw Error('no'); } });
  await assert.rejects(h.liveData.deletePhoto('album', 'photo'), { kind: 'server' });
  assert.equal(h.authCalls.length + h.requests.length + h.timers.size, 0);
});

test('a deletion is one DELETE to the encoded owner route with the bearer token and no body', async () => {
  const h = liveHarness({ send: () => response(200, { success: true, cleanupPending: false }) });
  assert.equal(await h.liveData.deletePhoto('album/x', 'photo?y'), 'deleted');
  assert.equal(h.requests.length, 1);
  const [request] = h.requests;
  assert.equal(request.url, 'https://mock.invalid/api/mobile/albums/album%2Fx/photos/photo%3Fy');
  assert.equal(request.method, 'DELETE');
  assert.equal(request.body, undefined);
  assert.equal(request.headers.Authorization, 'Bearer mock-token');
  assert.equal(h.timers.size, 0);
});

test('outcomes: 404 is already gone, a processing refusal is typed, anything else is an error', async () => {
  for (const [answer, expected] of [
    [response(200, { success: true, cleanupPending: true }), 'deleted'],
    [response(404, { error: 'Photo not found' }), 'gone'],
    [response(409, { error: 'x', code: 'PHOTO_PROCESSING' }), 'processing'],
  ]) {
    assert.equal(await liveHarness({ send: () => answer }).liveData.deletePhoto('a', 'p'), expected);
  }
  for (const [answer, kind] of [
    [response(409, { error: 'x', code: 'INVALID_STORAGE' }), 'server'],
    [response(200, { success: 'true' }), 'server'],
    [response(401, {}), 'unauthenticated'],
    [response(429, { error: 'x' }), 'server'],
    [response(500, { error: 'x' }), 'server'],
  ]) {
    await assert.rejects(liveHarness({ send: () => answer }).liveData.deletePhoto('a', 'p'), { kind });
  }
});

test('empty IDs never reach the network', async () => {
  const h = liveHarness({ send: () => response(200, { success: true }) });
  await assert.rejects(h.liveData.deletePhoto('', 'p'), { kind: 'server' });
  await assert.rejects(h.liveData.deletePhoto('a', ''), { kind: 'server' });
  assert.equal(h.requests.length, 0);
});

test('the photo feed drops confirmed deletions and ignores unknown IDs', async () => {
  const exports = {};
  vm.runInNewContext(transpile('data/photo-feed.ts'), {
    exports, Promise, Error, Set, Map, require(name) { assert.equal(name, './types'); return types; },
  });
  const photo = (id) => ({ id, isReady: true, processingStatus: 'done', createdAt: '2026-10-16T00:00:00.000Z' });
  const feed = new exports.PhotoFeed({ fetchPage: async () => ({ photos: [photo('a'), photo('b'), photo('c')], nextCursor: null }), fetchUpdates: async () => [] });
  await feed.reload();
  let published = 0;
  feed.subscribe(() => { published++; });
  feed.removePhotos(['b', 'missing']);
  assert.deepEqual([...feed.getSnapshot().photos.map((p) => p.id)], ['a', 'c']);
  assert.equal(published, 1);
  feed.removePhotos(['missing']);
  assert.equal(published, 1);
});

test('the viewer confirms with a destructive dialog, fences repeats and refuses processing photos', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/photo-viewer.tsx'), 'utf8');
  assert.match(source, /style: 'destructive'/);
  assert.match(source, /deletingRef\.current \|\|/);
  assert.match(source, /deletingRef\.current = true/);
  assert.match(source, /ACTIVE_PROCESSING\.has\(String\(photo\.processingStatus/);
  // The confirmation re-checks the visit before sending.
  assert.match(source, /async function runDelete[\s\S]*?!contextCurrent\(\)\) return/);
});
