/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// All network/auth/timer boundaries are fake. Never load the real Supabase client.
function transpile(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/data', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const types = {};
vm.runInNewContext(transpile('types.ts'), { exports: types, Error });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(status = 200, payload = { success: true }) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload };
}

function harness({ session, fetch: send } = {}) {
  const timers = new Map(), requests = [], authCalls = [], cleared = [];
  let sequence = 0;
  const exports = {};
  const mocks = {
    '@/lib/config': { SITE_URL: 'https://mock.invalid' },
    '@/lib/album-edit-release': { albumEditReleaseEnabled: false },
    '@/lib/album-access-release': { albumAccessReleaseEnabled: false },
    '@/lib/supabase': { supabase: { auth: { getSession() {
      authCalls.push('getSession');
      return session ? session() : Promise.resolve({
        data: { session: { access_token: 'mock-token', user: { id: 'owner' } } }, error: null,
      });
    } } } },
    './types': types,
  };
  vm.runInNewContext(transpile('live.ts') + '\nexports.testApi = api;', {
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
    clearTimeout(id) { cleared.push(id); timers.delete(id); },
    async fetch(url, init) {
      requests.push({ url, ...init });
      return send ? send(url, init) : response();
    },
  });
  return {
    api: exports.testApi, liveData: exports.liveData, timers, requests, authCalls, cleared,
    timeout() {
      for (const timer of [...timers.values()]) {
        assert.equal(timer.delay, 30_000);
        timer.fn();
      }
    },
  };
}

test('successful GET preserves payload and auth header, and releases its deadline', async () => {
  const expected = { photos: [{ id: 'photo' }], nextCursor: 'boundary' };
  const h = harness({ fetch: async () => response(200, expected) });
  assert.equal(await h.api('/test'), expected);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://mock.invalid/test');
  assert.equal(h.requests[0].method, 'GET');
  assert.equal(h.requests[0].headers.Authorization, 'Bearer mock-token');
  assert.equal(h.requests[0].signal.aborted, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.cleared.length, 1);
});

test('acknowledged album creation returns its ID without a follow-up read or a second write', async () => {
  const h = harness({ fetch: async () => response(201, { success: true, album: { id: 'created-album' } }) });
  const result = await h.liveData.createAlbum({ title: 'Wedding', description: 'Details' });
  assert.equal(result.id, 'created-album');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, 'POST');
  assert.equal(h.requests[0].url, 'https://mock.invalid/api/albums/create');
  assert.deepEqual(JSON.parse(h.requests[0].body), { title: 'Wedding', description: 'Details' });
  assert.equal(h.timers.size, 0);
});

test('malformed album creation acknowledgement is a typed error and never causes an automatic retry', async () => {
  for (const album of [undefined, null, {}, { id: null }, { id: '' }, { id: ' ' }]) {
    const h = harness({ fetch: async () => response(201, { success: true, album }) });
    await assert.rejects(h.liveData.createAlbum({ title: 'Wedding', description: '' }), { kind: 'server' });
    assert.equal(h.requests.length, 1);
  }
});

test('account usage preserves retryable refresh errors instead of claiming sign-out', async () => {
  for (const error of [
    { name: 'AuthRetryableFetchError', status: 503 },
    { name: 'AuthUnknownError', status: 0 },
  ]) {
    const h = harness({ session: async () => ({ data: { session: null }, error }) });
    await assert.rejects(h.liveData.fetchStorageUsage(), { kind: 'network' });
    assert.equal(h.requests.length, 0);
  }
});

test('account usage classifies rejected transports and invalid credentials separately', async () => {
  const network = harness({ session: async () => { throw new TypeError('offline'); } });
  await assert.rejects(network.liveData.fetchStorageUsage(), { kind: 'network' });
  const invalid = harness({ session: async () => ({
    data: { session: null }, error: { name: 'AuthApiError', status: 400 },
  }) });
  await assert.rejects(invalid.liveData.fetchStorageUsage(), { kind: 'unauthenticated' });
  const missing = harness({ session: async () => ({ data: { session: null }, error: null }) });
  await assert.rejects(missing.liveData.fetchStorageUsage(), { kind: 'unauthenticated' });
});

test('mutating calls serialize exactly once and never retry a missing acknowledgement', async () => {
  for (const method of ['POST', 'PATCH']) {
    const h = harness({ fetch: async () => new Promise(() => {}) });
    const pending = h.api('/mutation', { method, body: { albumId: 'album' } });
    const failed = assert.rejects(pending, { name: 'DataError', kind: 'network' });
    await flush();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].method, method);
    assert.equal(h.requests[0].body, '{"albumId":"album"}');
    h.timeout();
    await failed;
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('fetch timeout settles even when the transport ignores AbortSignal', async () => {
  const h = harness({ fetch: async () => new Promise(() => {}) });
  const pending = h.api('/slow');
  const failed = assert.rejects(pending, { kind: 'network' });
  await flush();
  h.timeout();
  await failed;
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('the same deadline covers a stalled response body after headers arrive', async () => {
  let bodyReads = 0;
  const h = harness({ fetch: async () => ({ status: 200, ok: true, json() {
    bodyReads += 1;
    return new Promise(() => {});
  } }) });
  const pending = h.api('/body-stalls');
  const failed = assert.rejects(pending, { kind: 'network' });
  await flush();
  assert.equal(bodyReads, 1);
  assert.equal(h.timers.size, 1);
  h.timeout();
  await failed;
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('an expired deadline prevents fetch after a stalled token refresh eventually resolves', async () => {
  const auth = deferred();
  const h = harness({ session: () => auth.promise });
  const pending = h.api('/test');
  const failed = assert.rejects(pending, { kind: 'network' });
  h.timeout();
  await failed;
  auth.resolve({ data: { session: { access_token: 'too-late' } }, error: null });
  await flush();
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('pre-aborted requests do not consult auth or start network activity', async () => {
  const controller = new AbortController();
  controller.abort();
  const h = harness();
  await assert.rejects(h.api('/test', { signal: controller.signal }), { kind: 'network' });
  assert.equal(h.authCalls.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('caller cancellation settles a request even if fetch ignores abort', async () => {
  const controller = new AbortController();
  const h = harness({ fetch: async () => new Promise(() => {}) });
  const pending = h.api('/test', { signal: controller.signal });
  const failed = assert.rejects(pending, { kind: 'network' });
  await flush();
  controller.abort();
  await failed;
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});

test('cancellation during token refresh prevents any subsequent request', async () => {
  const auth = deferred();
  const controller = new AbortController();
  const h = harness({ session: () => auth.promise });
  const pending = h.api('/test', { signal: controller.signal });
  const failed = assert.rejects(pending, { kind: 'network' });
  controller.abort();
  await failed;
  auth.resolve({ data: { session: { access_token: 'too-late' } }, error: null });
  await flush();
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('missing auth and returned auth errors block fetch even when a token is also returned', async () => {
  const cases = [
    { data: { session: null }, error: null },
    { data: { session: { access_token: 'must-not-use' } }, error: { name: 'AuthApiError', status: 401 } },
    { data: { session: null }, error: { name: 'AuthSessionMissingError' } },
  ];
  for (const session of cases) {
    const h = harness({ session: async () => session });
    await assert.rejects(h.api('/test'), { kind: 'unauthenticated' });
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('returned retryable auth transport errors are network failures, not session rejection', async () => {
  const h = harness({ session: async () => ({
    data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0 },
  }) });
  await assert.rejects(h.api('/test'), { kind: 'network' });
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('rejected auth promises are typed and cannot leak raw errors or retry requests', async () => {
  for (const [name, kind] of [['TypeError', 'network'], ['AuthSessionMissingError', 'unauthenticated']]) {
    const error = new Error('Synthetic auth failure');
    error.name = name;
    const h = harness({ session: async () => { throw error; } });
    await assert.rejects(h.api('/test'), { name: 'DataError', kind });
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('401 and 404 status mapping does not wait for an unavailable response body', async () => {
  for (const [status, kind] of [[401, 'unauthenticated'], [404, 'not-found']]) {
    let bodyReads = 0;
    const h = harness({ fetch: async () => ({ status, ok: false, json() {
      bodyReads += 1;
      return new Promise(() => {});
    } }) });
    await assert.rejects(h.api('/test'), { kind });
    assert.equal(bodyReads, 0);
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.timers.size, 0);
  }
});

test('other server statuses preserve safe string messages and never retry mutations', async () => {
  for (const status of [400, 403, 409, 429, 500, 503]) {
    const h = harness({ fetch: async () => response(status, { error: 'Synthetic server refusal' }) });
    await assert.rejects(h.api('/test', { method: 'POST', body: {} }), {
      kind: 'server', message: 'Synthetic server refusal',
    });
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('malformed JSON maps to server, while an interrupted response body maps to network', async () => {
  for (const [error, kind] of [[new SyntaxError('bad JSON'), 'server'], [new TypeError('read interrupted'), 'network']]) {
    const h = harness({ fetch: async () => ({ status: 200, ok: true, json: async () => { throw error; } }) });
    await assert.rejects(h.api('/test'), { kind });
    assert.equal(h.timers.size, 0);
  }
});

test('fetch rejection is a typed network error and the deadline is released', async () => {
  const h = harness({ fetch: async () => { throw new TypeError('offline'); } });
  await assert.rejects(h.api('/test'), { name: 'DataError', kind: 'network' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});

test('invalid request JSON is a typed server error without sending any mutation', async () => {
  const body = {};
  body.self = body;
  const h = harness();
  await assert.rejects(h.api('/test', { method: 'POST', body }), { kind: 'server' });
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('a null JSON payload remains a server failure, not an empty successful response', async () => {
  const h = harness({ fetch: async () => response(200, null) });
  await assert.rejects(h.api('/test'), { kind: 'server' });
  assert.equal(h.timers.size, 0);
});

test('liveData photo pages keep their public shapes and URL encoding through the bounded helper', async () => {
  const expected = { photos: [], nextCursor: null };
  const h = harness({ fetch: async () => response(200, expected) });
  assert.equal(await h.liveData.fetchPhotos('album/slash', 'time|id'), expected);
  assert.equal(h.requests[0].url, 'https://mock.invalid/api/mobile/albums/album%2Fslash/photos?cursor=time%7Cid');
  assert.equal(h.timers.size, 0);
});
