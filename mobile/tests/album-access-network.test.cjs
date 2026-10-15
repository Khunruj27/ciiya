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
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const revision = 'a'.repeat(64);
const settings = (overrides = {}) => ({
  albumId: 'album/slash', allowDownload: true, downloadSize: 'hd',
  isPasswordProtected: true, revision, ...overrides,
});
const input = (overrides = {}) => ({ ...settings(), password: '', ...overrides });
const context = (isCurrent = () => true, expectedOwnerId = 'owner') => ({ expectedOwnerId, isCurrent });
const response = (status = 200, payload = { success: true }) => ({
  status, ok: status >= 200 && status < 300, json: async () => payload,
});
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

// Only synthetic fixtures are sent to these mocked boundaries. An enabled mock
// does not change the app's closed release gate or contact a live owner API.
function harness({ enabled = true, session, fetch: send } = {}) {
  const timers = new Map(), requests = [], authCalls = [];
  let sequence = 0;
  const exports = {};
  const mocks = {
    '@/lib/config': { SITE_URL: 'https://mock.invalid' },
    '@/lib/album-edit-release': { albumEditReleaseEnabled: true },
    '@/lib/album-access-release': { albumAccessReleaseEnabled: enabled },
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

function demoHarness({ beforeDelay } = {}) {
  const exports = {};
  const mocks = { '@/lib/config': { SITE_URL: 'https://mock.invalid' }, './types': types };
  let fetches = 0;
  vm.runInNewContext(transpile('data/demo.ts'), {
    exports, Error,
    require(name) {
      if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
      return mocks[name];
    },
    setTimeout(fn) { beforeDelay?.(); fn(); return 0; },
    fetch() { fetches++; throw Error('Demo must not send a request'); },
  });
  return { data: exports.demoData, fetches: () => fetches };
}

test('actual access release is open, independent of environment/cache and metadata release', () => {
  for (const isDemoMode of [false, true]) {
    const exports = {};
    vm.runInNewContext(transpile('album-access-release.ts'), {
      exports, require(name) {
        assert.equal(name, '@/lib/config');
        return { isDemoMode };
      },
    });
    assert.equal(exports.albumAccessReleaseEnabled, true);
    assert.equal(exports.isAlbumAccessEditingAvailable(), true);
  }
  const original = fs.readFileSync(path.join(__dirname, '../src/lib/album-access-release.ts'), 'utf8');
  assert.doesNotMatch(original, /process\.env|EXPO_PUBLIC_.*ACCESS|fetch\(|getSession\(/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/lib/album-edit-release.ts'), 'utf8'),
    /albumEditReleaseEnabled = true/);
});

test('closed access GET and PATCH refuse before token, input getters, network, or timers', async () => {
  const h = harness({ enabled: false });
  const unreadable = new Proxy({}, { get() { throw Error('Input must not be inspected'); } });
  await assert.rejects(h.liveData.fetchAlbumAccess(unreadable, unreadable), { kind: 'server' });
  await assert.rejects(h.liveData.updateAlbumAccess(unreadable, unreadable), { kind: 'server' });
  assert.equal(h.authCalls.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('enabled synthetic GET uses exact owner route and returns a copied safe settings contract', async () => {
  const fixture = settings();
  const h = harness({ fetch: async () => response(200, { settings: fixture }) });
  const value = await h.liveData.fetchAlbumAccess('album/slash', context());
  assert.deepEqual(plain(value), fixture);
  assert.notEqual(value, fixture);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://mock.invalid/api/mobile/albums/album%2Fslash/access');
  assert.equal(h.requests[0].method, 'GET');
  assert.equal(h.requests[0].headers.Authorization, 'Bearer mock-token');
  assert.equal(h.requests[0].body, undefined);
  assert.equal(h.timers.size, 0);
});

test('read settings require strict booleans, enum, matching album and 64 lower-hex opaque revision', async () => {
  for (const bad of [
    { allowDownload: 'true' }, { allowDownload: 1 }, { isPasswordProtected: 'false' },
    { downloadSize: '4k' }, { downloadSize: null }, { albumId: 'another-owner-album' },
    { revision: null }, { revision: 'a'.repeat(63) }, { revision: 'A'.repeat(64) },
    { revision: 'g'.repeat(64) }, { revision: 'a'.repeat(65) },
  ]) {
    const h = harness({ fetch: async () => response(200, { settings: settings(bad) }) });
    await assert.rejects(h.liveData.fetchAlbumAccess('album/slash', context()), { kind: 'server' });
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('read refuses missing fields, raw album fallback, arrays, and unexpected security keys', async () => {
  const missingRevision = settings(); delete missingRevision.revision;
  for (const payload of [
    undefined, null, '', true, [], {}, { album: settings() }, settings(),
    { settings: null }, { settings: [] }, { settings: missingRevision },
    { settings: settings({ password: 'must-not-leak' }) },
    { settings: settings({ passwordHash: 'must-not-leak' }) },
    { settings: settings(), password: 'must-not-leak' },
  ]) {
    const h = harness({ fetch: async () => ({ ...response(), json: async () => payload }) });
    await assert.rejects(h.liveData.fetchAlbumAccess('album/slash', context()), { kind: 'server' });
  }
});

test('all four download-size values and protected/unprotected booleans are accepted exactly', async () => {
  for (const downloadSize of ['sd', 'hd', 'uhd', 'original']) {
    for (const isPasswordProtected of [false, true]) {
      const fixture = settings({ downloadSize, isPasswordProtected, allowDownload: false });
      const h = harness({ fetch: async () => response(200, { settings: fixture }) });
      assert.deepEqual(plain(await h.liveData.fetchAlbumAccess('album/slash', context())), fixture);
    }
  }
});

test('PATCH serializes only the bounded access body, never album ID/owner/publication/hash or legacy settings', async () => {
  const h = harness();
  await h.liveData.updateAlbumAccess(input({
    password: 'synthetic-password', title: 'must-not-edit', description: 'must-not-edit',
    ownerId: 'must-not-trust', shareToken: 'must-not-send', passwordHash: 'must-not-send',
    autoPublish: true, autoFaceScan: false,
  }), context());
  const request = h.requests[0];
  assert.equal(h.authCalls.length, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(request.url, 'https://mock.invalid/api/mobile/albums/album%2Fslash/access');
  assert.equal(request.method, 'PATCH');
  assert.equal(request.headers.Authorization, 'Bearer mock-token');
  assert.deepEqual(JSON.parse(request.body), {
    allowDownload: true, downloadSize: 'hd', isPasswordProtected: true,
    password: 'synthetic-password', revision,
  });
  assert.equal(request.signal.aborted, false);
  assert.equal(h.timers.size, 0);
});

test('PATCH requires an acknowledgement success exactly true, including malformed primitive/undefined bodies', async () => {
  for (const payload of [undefined, null, [], '', true, 1, {}, { success: false }, { success: 'true' }, { success: 1 }]) {
    const h = harness({ fetch: async () => ({ ...response(), json: async () => payload }) });
    await assert.rejects(h.liveData.updateAlbumAccess(input(), context()), { kind: 'server' });
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('malformed PATCH fields refuse before token or network and never silently coerce values', async () => {
  for (const bad of [
    { albumId: '' }, { albumId: null }, { allowDownload: 'false' },
    { isPasswordProtected: 1 }, { downloadSize: 'full' }, { downloadSize: 0 },
    { password: null }, { revision: '' }, { revision: 'A'.repeat(64) },
  ]) {
    const h = harness();
    await assert.rejects(h.liveData.updateAlbumAccess(input(bad), context()), { kind: 'server' });
    assert.equal(h.authCalls.length, 0);
    assert.equal(h.requests.length, 0);
  }
});

test('password validation uses 72 UTF-8 bytes, including Thai, emoji and unpaired surrogates', async () => {
  for (const password of ['a'.repeat(72), 'ก'.repeat(24), '😀'.repeat(18), '\ud800'.repeat(24)]) {
    const h = harness();
    await h.liveData.updateAlbumAccess(input({ password }), context());
    assert.equal(h.requests.length, 1);
  }
  for (const password of ['a'.repeat(73), 'ก'.repeat(25), '😀'.repeat(19), '\ud800'.repeat(25)]) {
    const h = harness();
    await assert.rejects(h.liveData.updateAlbumAccess(input({ password }), context()), { kind: 'server' });
    assert.equal(h.authCalls.length, 0);
    assert.equal(h.requests.length, 0);
  }
});

test('access PATCH 409 is typed conflict without reading error body or performing automatic retry', async () => {
  let bodyReads = 0;
  const h = harness({ fetch: async () => ({ ...response(409), json() {
    bodyReads++; return new Promise(() => {});
  } }) });
  await assert.rejects(h.liveData.updateAlbumAccess(input(), context()), { kind: 'conflict' });
  assert.equal(bodyReads, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('409 retains existing server meaning outside the scoped access mutation', async () => {
  const h = harness({ fetch: async () => response(409, { error: 'synthetic-denial' }) });
  await assert.rejects(h.liveData.updateAlbumDetails({ albumId: 'album', title: 'Title', description: '' }), { kind: 'server' });
  await assert.rejects(h.liveData.setAlbumCover('album', 'photo'), { kind: 'server' });
  await assert.rejects(h.liveData.fetchAlbumAccess('album', context()), { kind: 'server' });
  assert.equal(h.requests.length, 3);
});

test('access GET 404 is not-found but write 404 remains unavailable release; 401 always unauthenticated', async () => {
  for (const status of [401, 404]) {
    let bodyReads = 0;
    const h = harness({ fetch: async () => ({ ...response(status), json() {
      bodyReads++; return new Promise(() => {});
    } }) });
    await assert.rejects(h.liveData.fetchAlbumAccess('album', context()), { kind: status === 401 ? 'unauthenticated' : 'not-found' });
    await assert.rejects(h.liveData.updateAlbumAccess(input(), context()), { kind: status === 401 ? 'unauthenticated' : 'server' });
    assert.equal(bodyReads, 0);
    assert.equal(h.requests.length, 2);
    assert.equal(h.timers.size, 0);
  }
});

test('other denial statuses have no retry or write-to-legacy fallback', async () => {
  for (const status of [400, 403, 410, 429, 500, 503]) {
    const h = harness({ fetch: async () => response(status, { error: 'synthetic-denial' }) });
    await assert.rejects(h.liveData.updateAlbumAccess(input(), context()), { kind: 'server' });
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('legacy full sharing settings/deletion stay closed with the new access gate both disabled and enabled', async () => {
  for (const enabled of [false, true]) {
    const h = harness({ enabled });
    await assert.rejects(h.liveData.updateAlbumSettings(input({ title: 'Title', description: '' })), { kind: 'server' });
    await assert.rejects(h.liveData.deleteAlbum('album'), { kind: 'server' });
    assert.equal(h.authCalls.length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('an access write times out once without retry if the request or response body never acknowledges', async () => {
  for (const send of [
    async () => new Promise(() => {}),
    async () => ({ ...response(), json: async () => new Promise(() => {}) }),
  ]) {
    const h = harness({ fetch: send });
    const rejection = assert.rejects(h.liveData.updateAlbumAccess(input(), context()), { kind: 'network' });
    await flush();
    h.timeout();
    await rejection;
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.timers.size, 0);
  }
});

test('late refreshed token cannot send access mutation after the shared deadline', async () => {
  const auth = deferred();
  const h = harness({ session: () => auth.promise });
  const rejection = assert.rejects(h.liveData.updateAlbumAccess(input(), context()), { kind: 'network' });
  h.timeout();
  await rejection;
  auth.resolve({ data: { session: { access_token: 'late-mock-token' } }, error: null });
  await flush();
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('token denial cannot start access requests', async () => {
  const h = harness({ session: async () => ({
    data: { session: { access_token: 'must-not-use' } }, error: { name: 'AuthApiError', status: 401 },
  }) });
  await assert.rejects(h.liveData.fetchAlbumAccess('album', context()), { kind: 'unauthenticated' });
  await assert.rejects(h.liveData.updateAlbumAccess(input(), context()), { kind: 'unauthenticated' });
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('Demo access reads return detached exact fields and stable 64-hex in-memory revisions', async () => {
  const h = demoHarness();
  const first = await h.data.fetchAlbumAccess('demo-2', context());
  assert.match(first.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(first).sort(), ['albumId', 'allowDownload', 'downloadSize', 'isPasswordProtected', 'revision'].sort());
  first.allowDownload = false;
  const next = await h.data.fetchAlbumAccess('demo-2', context());
  assert.equal(next.allowDownload, true);
  assert.equal(next.revision, first.revision);
  assert.equal(h.fetches(), 0);
});

test('Demo protected blank password preserves protection while every accepted edit advances revision', async () => {
  const h = demoHarness();
  const first = await h.data.fetchAlbumAccess('demo-2', context());
  await h.data.updateAlbumAccess({ ...first, allowDownload: false, password: '' }, context());
  const second = await h.data.fetchAlbumAccess('demo-2', context());
  assert.equal(second.isPasswordProtected, true);
  assert.equal(second.allowDownload, false);
  assert.notEqual(second.revision, first.revision);
  await h.data.updateAlbumAccess({ ...second, password: '' }, context());
  const third = await h.data.fetchAlbumAccess('demo-2', context());
  assert.notEqual(third.revision, second.revision);
  assert.equal(h.fetches(), 0);
});

test('Demo enabling protection requires a password, obeys UTF-8 limit and stores no password fields', async () => {
  const h = demoHarness();
  const first = await h.data.fetchAlbumAccess('demo-1', context());
  await assert.rejects(h.data.updateAlbumAccess({ ...first, isPasswordProtected: true, password: '' }, context()), { kind: 'server' });
  await assert.rejects(h.data.updateAlbumAccess({ ...first, isPasswordProtected: true, password: 'ก'.repeat(25) }, context()), { kind: 'server' });
  assert.equal((await h.data.fetchAlbumAccess('demo-1', context())).revision, first.revision);
  await h.data.updateAlbumAccess({ ...first, isPasswordProtected: true, password: 'ก'.repeat(24) }, context());
  const next = await h.data.fetchAlbumAccess('demo-1', context());
  assert.equal(next.isPasswordProtected, true);
  assert.notEqual(next.revision, first.revision);
  assert.equal(Object.hasOwn(next, 'password'), false);
  assert.equal(Object.hasOwn(await h.data.fetchAlbum('demo-1'), 'password'), false);
  assert.equal(h.fetches(), 0);
});

test('Demo access conflict refuses stale overwrite without losing newest flags or revision', async () => {
  const h = demoHarness();
  const first = await h.data.fetchAlbumAccess('demo-2', context());
  await h.data.updateAlbumAccess({ ...first, downloadSize: 'original', password: '' }, context());
  const next = await h.data.fetchAlbumAccess('demo-2', context());
  await assert.rejects(h.data.updateAlbumAccess({ ...first, isPasswordProtected: false, password: '' }, context()), { kind: 'conflict' });
  assert.deepEqual(plain(await h.data.fetchAlbumAccess('demo-2', context())), plain(next));
  await h.data.updateAlbumAccess({ ...next, isPasswordProtected: false, password: '' }, context());
  assert.equal((await h.data.fetchAlbumAccess('demo-2', context())).isPasswordProtected, false);
});

test('Demo access only changes access fields and rejects invalid fields without remote I/O', async () => {
  const h = demoHarness();
  const original = await h.data.fetchAlbum('demo-2');
  const first = await h.data.fetchAlbumAccess('demo-2', context());
  for (const bad of [{ allowDownload: 1 }, { downloadSize: 'full' }, { isPasswordProtected: null }, { password: null }]) {
    await assert.rejects(h.data.updateAlbumAccess({ ...first, password: '', ...bad }, context()), { kind: 'server' });
  }
  await h.data.updateAlbumAccess({
    ...first, allowDownload: false, password: '', title: 'must-not-edit', shareToken: 'must-not-edit',
    autoFaceScan: false, autoPublish: true, ownerId: 'must-not-trust',
  }, context());
  const latest = await h.data.fetchAlbum('demo-2');
  for (const field of ['id', 'title', 'description', 'shareToken', 'autoFaceScan', 'autoPublish', 'coverUrl', 'photoCount']) {
    assert.equal(latest[field], original[field]);
  }
  assert.equal(latest.allowDownload, false);
  assert.equal(h.fetches(), 0);
});

test('Demo revisions and flags are isolated per album and reset with a fresh in-memory datasource', async () => {
  const h = demoHarness();
  const other = await h.data.fetchAlbumAccess('demo-1', context());
  const first = await h.data.fetchAlbumAccess('demo-2', context());
  await h.data.updateAlbumAccess({ ...first, allowDownload: false, password: '' }, context());
  assert.deepEqual(plain(await h.data.fetchAlbumAccess('demo-1', context())), plain(other));
  assert.equal((await demoHarness().data.fetchAlbumAccess('demo-2', context())).allowDownload, true);
  await assert.rejects(h.data.fetchAlbumAccess('not-an-album', context()), { kind: 'not-found' });
  assert.equal(h.fetches(), 0);
});

test('enabled access direct calls require a current captured context before auth, input inspection or timers', async () => {
  for (const bad of [
    undefined, null, {}, context(() => false), context(() => 'true'),
    context(() => { throw Error('Synthetic invalid lifetime'); }), context(() => true, ''),
    { expectedOwnerId: 'owner', isCurrent: null },
  ]) {
    const h = harness();
    const unreadable = new Proxy({}, { get() { throw Error('Must not inspect stale input'); } });
    await assert.rejects(h.liveData.fetchAlbumAccess(unreadable, bad), { kind: 'unauthenticated' });
    await assert.rejects(h.liveData.updateAlbumAccess(unreadable, bad), { kind: 'unauthenticated' });
    assert.equal(h.authCalls.length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('delayed token refresh after logout/same-owner return or blur/refocus sends no access GET or PATCH', async () => {
  for (const transition of ['logout-return', 'blur-refocus']) {
    for (const method of ['GET', 'PATCH']) {
      let visit = 1;
      const capturedVisit = visit;
      const lifetime = context(() => visit === capturedVisit);
      const auth = deferred();
      const h = harness({ session: () => auth.promise });
      const pending = method === 'GET'
        ? h.liveData.fetchAlbumAccess('album/slash', lifetime)
        : h.liveData.updateAlbumAccess(input(), lifetime);
      const rejected = assert.rejects(pending, { kind: 'unauthenticated' });
      visit++; // The captured lifetime leaves.
      visit++; // The same owner/focus returns in a different lifetime.
      auth.resolve({ data: { session: { access_token: 'mock-token', user: { id: 'owner' } } }, error: null });
      await rejected;
      assert.equal(h.authCalls.length, 1, transition);
      assert.equal(h.requests.length, 0, transition);
      assert.equal(h.timers.size, 0);
    }
  }
});

test('a refreshed foreign-owner token never starts access transport even if the old screen predicate remains true', async () => {
  const h = harness({ session: async () => ({
    data: { session: { access_token: 'foreign-mock-token', user: { id: 'other-owner' } } }, error: null,
  }) });
  await assert.rejects(h.liveData.fetchAlbumAccess('album/slash', context()), { kind: 'unauthenticated' });
  await assert.rejects(h.liveData.updateAlbumAccess(input(), context()), { kind: 'unauthenticated' });
  assert.equal(h.authCalls.length, 2);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('caller edits cannot replace the owner or predicate captured while getSession is pending', async () => {
  for (const method of ['GET', 'PATCH']) {
    let current = true;
    const lifetime = context(() => current);
    const auth = deferred();
    const h = harness({ session: () => auth.promise });
    const pending = method === 'GET'
      ? h.liveData.fetchAlbumAccess('album/slash', lifetime)
      : h.liveData.updateAlbumAccess(input(), lifetime);
    const rejected = assert.rejects(pending, { kind: 'unauthenticated' });
    current = false;
    lifetime.expectedOwnerId = 'other-owner';
    lifetime.isCurrent = () => true;
    auth.resolve({ data: { session: { access_token: 'foreign-mock-token', user: { id: 'other-owner' } } }, error: null });
    await rejected;
    assert.equal(h.requests.length, 0);
  }
});

test('an expiry between owner validation and the immediate fetch boundary still prevents any access request', async () => {
  for (const method of ['GET', 'PATCH']) {
    let current = true;
    const h = harness({ session: async () => ({ data: { session: {
      user: { id: 'owner' },
      get access_token() { current = false; return 'expired-mock-token'; },
    } }, error: null }) });
    const pending = method === 'GET'
      ? h.liveData.fetchAlbumAccess('album/slash', context(() => current))
      : h.liveData.updateAlbumAccess(input(), context(() => current));
    await assert.rejects(pending, { kind: 'unauthenticated' });
    assert.equal(h.authCalls.length, 1);
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('late access headers after lifetime expiry never read a body or publish acknowledgement', async () => {
  for (const method of ['GET', 'PATCH']) {
    let current = true, bodyReads = 0;
    const headers = deferred();
    const h = harness({ fetch: () => headers.promise });
    const pending = method === 'GET'
      ? h.liveData.fetchAlbumAccess('album/slash', context(() => current))
      : h.liveData.updateAlbumAccess(input(), context(() => current));
    const rejected = assert.rejects(pending, { kind: 'unauthenticated' });
    await flush();
    assert.equal(h.requests.length, 1);
    current = false;
    headers.resolve({ ...response(), json() { bodyReads++; return Promise.resolve({ success: true }); } });
    await rejected;
    assert.equal(bodyReads, 0);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.timers.size, 0);
  }
});

test('late access JSON after expiry is not a successful read or saved acknowledgement', async () => {
  for (const method of ['GET', 'PATCH']) {
    let current = true;
    const body = deferred();
    const h = harness({ fetch: async () => ({ ...response(), json: () => body.promise }) });
    const pending = method === 'GET'
      ? h.liveData.fetchAlbumAccess('album/slash', context(() => current))
      : h.liveData.updateAlbumAccess(input(), context(() => current));
    const rejected = assert.rejects(pending, { kind: 'unauthenticated' });
    await flush();
    current = false;
    body.resolve(method === 'GET' ? { settings: settings() } : { success: true });
    await rejected;
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.timers.size, 0);
  }
});

test('access context is rechecked at final settings/acknowledgement publication, not only inside the HTTP helper', async () => {
  for (const method of ['GET', 'PATCH']) {
    let current = true;
    const payload = method === 'GET' ? { settings: settings() } : {};
    if (method === 'GET') Object.defineProperty(payload.settings, 'allowDownload', {
      enumerable: true, get() { current = false; return true; },
    });
    else Object.defineProperty(payload, 'success', { get() { current = false; return true; } });
    const h = harness({ fetch: async () => response(200, payload) });
    const pending = method === 'GET'
      ? h.liveData.fetchAlbumAccess('album/slash', context(() => current))
      : h.liveData.updateAlbumAccess(input(), context(() => current));
    await assert.rejects(pending, { kind: 'unauthenticated' });
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('Demo access expires during local delay without changing flags/revision or publishing stale settings', async () => {
  let expireOnDelay = false, current = true;
  const h = demoHarness({ beforeDelay() { if (expireOnDelay) current = false; } });
  const first = await h.data.fetchAlbumAccess('demo-2', context(() => current));
  expireOnDelay = true;
  await assert.rejects(h.data.updateAlbumAccess({ ...first, allowDownload: false, password: '' }, context(() => current)),
    { kind: 'unauthenticated' });
  current = true;
  await assert.rejects(h.data.fetchAlbumAccess('demo-2', context(() => current)), { kind: 'unauthenticated' });
  expireOnDelay = false;
  assert.deepEqual(plain(await h.data.fetchAlbumAccess('demo-2', context())), plain(first));
  assert.equal(h.fetches(), 0);
});
