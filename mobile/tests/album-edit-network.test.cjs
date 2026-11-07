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
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(status = 200, payload = { success: true }) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload };
}

// The real live datasource is transpiled, but every auth/network/timer boundary
// is fake. Enabling a release here changes only a mock, never app configuration.
function harness({ enabled = true, session, fetch: send } = {}) {
  const timers = new Map(), requests = [], authCalls = [];
  let sequence = 0;
  const exports = {};
  const mocks = {
    '@/lib/config': { SITE_URL: 'https://mock.invalid' },
    '@/lib/album-edit-release': { albumEditReleaseEnabled: enabled, isAlbumEditingAvailable: () => enabled },
    '@/lib/photo-retry-release': { photoRetryReleaseEnabled: false, isPhotoRetryAvailable: () => false },
    '@/lib/preset-release': { presetReleaseEnabled: false, isPresetPickingAvailable: () => false },
    '@/lib/photo-delete-release': { photoDeleteReleaseEnabled: false, isPhotoDeleteAvailable: () => false },
    '@/lib/photo-reprocess-release': { photoReprocessReleaseEnabled: false, isPhotoReprocessAvailable: () => false },
    '@/lib/photo-retry': { MAX_PHOTO_RETRIES_PER_TAP: 50, retryablePhotos: () => [], async retryPhotos() { throw Error('Closed retry gate must not send'); } },
    '@/lib/album-access-release': { albumAccessReleaseEnabled: false },
    '@/lib/supabase': { supabase: { auth: { getSession() {
      authCalls.push('getSession');
      return session ? session() : Promise.resolve({
        data: { session: { access_token: 'mock-token', user: { id: 'owner' } } }, error: null,
      });
    } } } },
    './types': types,
  };
  vm.runInNewContext(transpile('data/live.ts'), {
    exports, Promise, AbortController, Error, SyntaxError,
    require(name) {
      if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
      return mocks[name];
    },
    setTimeout(fn, delay) {
      const id = ++sequence;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, init) {
      requests.push({ url, ...init });
      return send ? send(url, init) : response();
    },
  });
  return {
    liveData: exports.liveData, timers, requests, authCalls,
    timeout() {
      for (const timer of [...timers.values()]) {
        assert.equal(timer.delay, 30_000);
        timer.fn();
      }
    },
  };
}

function mutations(h) {
  return [
    () => h.liveData.updateAlbumDetails({ albumId: 'album/slash', title: 'Wedding', description: 'Details' }),
    () => h.liveData.setAlbumCover('album/slash', 'photo/id'),
  ];
}

test('unreleased live editing fails before token access, fetch, timers or automatic fallback', async () => {
  for (const index of [0, 1]) {
    const h = harness({ enabled: false });
    await assert.rejects(mutations(h)[index](), { kind: 'server' });
    assert.equal(h.authCalls.length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('the approved metadata/cover release gate is enabled independently of Demo and environment switches', () => {
  const source = transpile('album-edit-release.ts');
  for (const demo of [false, true]) {
    const exports = {};
    vm.runInNewContext(source, { exports, require(name) {
      assert.equal(name, '@/lib/config');
      return { isDemoMode: demo };
    } });
    assert.equal(exports.albumEditReleaseEnabled, true);
    assert.equal(exports.isAlbumEditingAvailable(), true);
  }
  const original = fs.readFileSync(path.join(__dirname, '../src/lib/album-edit-release.ts'), 'utf8');
  assert.doesNotMatch(original, /process\.env|EXPO_PUBLIC_.*EDIT|fetch\(|getSession\(/);
});

test('metadata editing uses the narrow mobile details route and serializes only title and description', async () => {
  const h = harness();
  await h.liveData.updateAlbumDetails({
    albumId: 'album/slash', title: 'Wedding', description: 'Details',
    allowDownload: false, downloadSize: 'original', isPasswordProtected: false,
    password: 'private-password-fixture', shareToken: 'private-token-fixture',
    userId: 'body-owner-must-not-be-trusted', autoPublish: false, autoFaceScan: false,
  });
  assert.equal(h.authCalls.length, 1);
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.method, 'PATCH');
  assert.equal(request.url, 'https://mock.invalid/api/mobile/albums/album%2Fslash/details');
  assert.equal(request.headers.Authorization, 'Bearer mock-token');
  assert.deepEqual(JSON.parse(request.body), { title: 'Wedding', description: 'Details' });
  assert.equal(request.signal.aborted, false);
  assert.equal(h.timers.size, 0);
});

test('cover selection uses the narrow mobile cover route and a photo-ID-only body', async () => {
  const h = harness();
  await h.liveData.setAlbumCover('album/slash', 'photo/id');
  assert.equal(h.authCalls.length, 1);
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.url, 'https://mock.invalid/api/mobile/albums/album%2Fslash/cover');
  assert.equal(request.method, 'PATCH');
  assert.deepEqual(JSON.parse(request.body), { photoId: 'photo/id' });
  assert.equal(h.timers.size, 0);
});

test('legacy full sharing/password settings and deletion stay blocked even when metadata is enabled in a mock', async () => {
  for (const enabled of [false, true]) {
    const h = harness({ enabled });
    await assert.rejects(h.liveData.updateAlbumSettings({
      albumId: 'album', title: 'Wedding', description: 'Details', allowDownload: false,
      downloadSize: 'original', isPasswordProtected: false, password: 'private-password-fixture',
    }), { kind: 'server' });
    await assert.rejects(h.liveData.deleteAlbum('album'), { kind: 'server' });
    assert.equal(h.authCalls.length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('both edits require success exactly true, never treating a missing or ambiguous acknowledgement as saved', async () => {
  for (const payload of [{}, null, { success: false }, { success: 'true' }, { success: 1 }, { success: null }]) {
    for (const index of [0, 1]) {
      const h = harness({ fetch: async () => response(200, payload) });
      await assert.rejects(mutations(h)[index](), { kind: 'server' });
      assert.equal(h.requests.length, 1);
      assert.equal(h.authCalls.length, 1);
      assert.equal(h.timers.size, 0);
    }
  }
});

test('write-route 404 means unavailable release, not lost album, and does not wait for an unreadable body', async () => {
  for (const index of [0, 1]) {
    let bodyReads = 0;
    const h = harness({ fetch: async () => ({ status: 404, ok: false, json() {
      bodyReads++;
      return new Promise(() => {});
    } }) });
    await assert.rejects(mutations(h)[index](), { kind: 'server' });
    assert.equal(bodyReads, 0);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.timers.size, 0);
  }
  const reads = harness({ fetch: async () => response(404) });
  await assert.rejects(reads.liveData.fetchAlbum('album'), { kind: 'not-found' });
});

test('write-route 401 remains a session failure and server denial is never retried', async () => {
  for (const [status, kind] of [[401, 'unauthenticated'], [400, 'server'], [403, 'server'], [409, 'server'], [429, 'server'], [500, 'server'], [503, 'server']]) {
    for (const index of [0, 1]) {
      const h = harness({ fetch: async () => response(status, { error: 'private-server-fixture' }) });
      await assert.rejects(mutations(h)[index](), { kind });
      assert.equal(h.authCalls.length, 1);
      assert.equal(h.requests.length, 1);
      assert.equal(h.timers.size, 0);
    }
  }
});

test('a missing acknowledgement times out exactly one mutation without automatic retry or legacy-route fallback', async () => {
  for (const index of [0, 1]) {
    const h = harness({ fetch: async () => new Promise(() => {}) });
    const pending = mutations(h)[index]();
    const rejected = assert.rejects(pending, { kind: 'network' });
    await flush();
    assert.equal(h.requests.length, 1);
    h.timeout();
    await rejected;
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.timers.size, 0);
  }
});

test('token-refresh failure cannot start a metadata or cover write', async () => {
  for (const index of [0, 1]) {
    const h = harness({ session: async () => ({
      data: { session: { access_token: 'must-not-use' } }, error: { name: 'AuthApiError', status: 401 },
    }) });
    await assert.rejects(mutations(h)[index](), { kind: 'unauthenticated' });
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('an expired refresh deadline never sends a mutation if a token arrives later', async () => {
  for (const index of [0, 1]) {
    const auth = deferred();
    const h = harness({ session: () => auth.promise });
    const pending = mutations(h)[index]();
    const rejected = assert.rejects(pending, { kind: 'network' });
    h.timeout();
    await rejected;
    auth.resolve({ data: { session: { access_token: 'late-token-fixture' } }, error: null });
    await flush();
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
  }
});
