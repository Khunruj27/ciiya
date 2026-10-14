/* global __dirname, Response, ReadableStream */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } = require('@supabase/auth-js');

// Shipped TS + installed SDK error classes; only native/auth/network boundaries
// are mocked. Never read .env, send a real request or delete a real object.
function load(relative, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../src/lib', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (!Object.hasOwn(mocks, name)) throw new Error(`Unmocked dependency: ${name}`);
      return mocks[name];
    },
    AbortController, Promise, Date, Map, Set, SyntaxError, console,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    ...globals,
  }, { filename });
  return exports;
}

const types = load('uploads/types.ts');
const boundedFetch = load('bounded-fetch.ts');
const timeout = boundedFetch.SUPABASE_REQUEST_TIMEOUT_MS;
const flush = () => new Promise(resolve => setImmediate(resolve));
const pending = () => new Promise(() => {});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const session = (owner = 'A', token = 'offline-access') => ({
  access_token: token, user: { id: owner },
});
const storedPath = 'A/album/original/offline-photo.jpg';
const reservation = {
  success: true, uploadSessionId: 'offline-reservation',
  uploadUrl: 'https://storage-test.invalid/photo', headers: {},
  storagePath: storedPath, bucket: 'albums', fileHash: 'offline-hash',
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const stalledBody = (status = 200) => new Response(new ReadableStream({ start() {} }), {
  status, headers: { 'Content-Type': 'application/json' },
});
function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
}

function harness({ getSession, refreshSession, send, upload } = {}) {
  const requests = [], uploads = [], removed = [], staged = [];
  let authReads = 0, refreshes = 0, finishing = 0;
  const controller = new AbortController();
  const supabase = {
    auth: {
      getSession: async () => {
        authReads++;
        return getSession ? getSession() : { data: { session: session() }, error: null };
      },
      refreshSession: async () => {
        refreshes++;
        return refreshSession ? refreshSession() : { data: { session: session('A', 'offline-fresh') }, error: null };
      },
    },
    storage: { from: () => ({ remove: async paths => { removed.push(...paths); } }) },
  };
  const { liveTransport } = load('uploads/live-transport.ts', {
    '@/lib/config': { SITE_URL: 'https://upload-test.invalid' },
    '@/lib/supabase': { supabase },
    '@/lib/bounded-fetch': boundedFetch,
    './types': types,
    './files': { localFile: () => ({ exists: true, upload: async (url, options) => {
      assert.ok(url.startsWith('https://storage-test.invalid/'), 'Never send a real photo');
      uploads.push({ url, ...options });
      return upload ? upload(url, options) : { status: 200 };
    } }) },
  }, {
    fetch: async (url, options) => {
      assert.ok(url.startsWith('https://upload-test.invalid/'), 'Never contact production');
      const request = { url, ...options, body: JSON.parse(options.body) };
      requests.push(request);
      return send ? send(request) : reply(url.endsWith('/upload-url') ? reservation : { success: true });
    },
  });
  const item = {
    id: 'offline-upload', ownerId: 'A', albumId: 'album', fileName: 'photo.jpg',
    mimeType: 'image/jpeg', sizeBytes: 200 * 1024 * 1024, fileHash: 'offline-hash',
    localName: 'offline-copy.jpg', size: 'original', autoFaceScan: false,
    autoPublish: false, status: 'queued', progress: 0, attempts: 0,
    failure: null, registering: false, staged: null, createdAt: 1,
  };
  const hooks = {
    signal: controller.signal, onProgress() {},
    onStaged: value => { staged.push(value); },
    onFinishing: () => { finishing++; },
  };
  return {
    liveTransport, item, hooks, controller, requests, uploads, removed, staged,
    authReads: () => authReads, refreshes: () => refreshes, finishing: () => finishing,
    run: () => liveTransport.upload(item, hooks),
  };
}

function networkFailure(error) {
  assert.equal(error.failure, 'network');
  assert.equal(error.retryable, true);
  assert.equal(error.signedOut, false);
  assert.doesNotMatch(error.message, /private-info|offline-access|offline-refresh|https:/);
  return true;
}

test('stalled reserve headers time out once, abort their transport and never gate the queue on sign-in', async t => {
  clock(t);
  const h = harness({ send: pending });
  const rejected = assert.rejects(h.run(), networkFailure);
  await flush();
  assert.equal(h.requests.length, 1);
  t.mock.timers.tick(timeout);
  await rejected;
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests.length, 1, 'Missing acknowledgement cannot resend a mutation');
  assert.equal(h.uploads.length, 0);
  assert.deepEqual(h.removed, []);
});

test('stalled R2 finalize JSON times out and retains the possibly accepted stored bytes', async t => {
  clock(t);
  const h = harness({ send: request => request.url.endsWith('/upload-url') ? reply(reservation) : stalledBody() });
  const rejected = assert.rejects(h.run(), networkFailure);
  await flush();
  assert.equal(h.requests.length, 2);
  t.mock.timers.tick(timeout);
  await rejected;
  assert.equal(h.finishing(), 1);
  assert.deepEqual(h.staged, []);
  assert.deepEqual(h.removed, []);
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(request => request.method === 'POST'));
  assert.equal(h.requests[1].signal.aborted, true);
});

test('caller abort settles stalled finalize-body reading without waiting for its deadline or deleting originals', async t => {
  clock(t);
  const h = harness({ send: request => request.url.endsWith('/upload-url') ? reply(reservation) : stalledBody() });
  const rejected = assert.rejects(h.run(), { failure: 'network', signedOut: false });
  await flush();
  h.controller.abort('private-info');
  await rejected;
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].signal.aborted, true);
  assert.deepEqual(h.removed, []);
  assert.deepEqual(h.staged, []);
  assert.ok(h.requests.every(request => request.method === 'POST'));
});

test('stalled getSession times out before network and its late result cannot start an upload', async t => {
  clock(t);
  const read = deferred();
  const h = harness({ getSession: () => read.promise });
  const rejected = assert.rejects(h.run(), networkFailure);
  await flush();
  t.mock.timers.tick(timeout);
  await rejected;
  assert.equal(h.authReads(), 1);
  read.resolve({ data: { session: session() }, error: null });
  await flush();
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.uploads, []);
});

test('caller abort during session read makes no request even when a usable token arrives later', async t => {
  clock(t);
  const read = deferred();
  const h = harness({ getSession: () => read.promise });
  const rejected = assert.rejects(h.run(), { failure: 'network', signedOut: false });
  await flush();
  h.controller.abort();
  await rejected;
  read.resolve({ data: { session: session() }, error: null });
  await flush();
  assert.deepEqual(h.requests, []);
});

test('retryable auth errors, 429/5xx and rejected transports stay network failures even alongside stale tokens', async () => {
  const errors = [
    new AuthRetryableFetchError('private-info https://auth.invalid', 0),
    new AuthApiError('private-info', 503, 'server_error'),
    new AuthApiError('private-info', 429, 'over_request_rate_limit'),
  ];
  for (const error of errors) {
    const h = harness({ getSession: async () => ({ data: { session: session() }, error }) });
    await assert.rejects(h.run(), networkFailure);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.uploads, []);
  }
  const rejected = harness({ getSession: async () => { throw new TypeError('private-info https://auth.invalid'); } });
  await assert.rejects(rejected.run(), networkFailure);
  assert.deepEqual(rejected.requests, []);
});

test('genuine missing/invalid sessions and a foreign owner remain signed-out failures with no upload or cleanup', async () => {
  const results = [
    { data: { session: null }, error: null },
    { data: { session: session('B') }, error: null },
    { data: { session: session() }, error: new AuthSessionMissingError() },
    { data: { session: session() }, error: new AuthApiError('private-info', 400, 'refresh_token_not_found') },
  ];
  for (const result of results) {
    const h = harness({ getSession: async () => result });
    await assert.rejects(h.run(), { failure: 'session', signedOut: true });
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.uploads, []);
    assert.deepEqual(h.removed, []);
  }
});

test('an authoritative 401 with a retryable refresh failure does not become a permanent sign-in gate', async () => {
  for (const reject of [false, true]) {
    const error = new AuthRetryableFetchError('private-info offline-refresh', 0);
    const h = harness({
      send: () => reply({}, 401),
      refreshSession: async () => {
        if (reject) throw error;
        return { data: { session: null }, error };
      },
    });
    await assert.rejects(h.run(), networkFailure);
    assert.equal(h.refreshes(), 1);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.uploads, []);
  }
});

test('the same 30s API deadline covers a slow 401 and stalled refresh, with no late resend', async t => {
  clock(t);
  const headers = deferred();
  const refresh = deferred();
  const h = harness({ send: () => headers.promise, refreshSession: () => refresh.promise });
  const rejected = assert.rejects(h.run(), networkFailure);
  await flush();
  t.mock.timers.tick(20_000);
  headers.resolve(reply({}, 401));
  await flush();
  assert.equal(h.refreshes(), 1);
  t.mock.timers.tick(10_000);
  await rejected;
  refresh.resolve({ data: { session: session('A', 'offline-fresh') }, error: null });
  await flush();
  assert.equal(h.requests.length, 1);
});

test('caller abort during 401 refresh settles immediately and prevents the refreshed token from resending', async t => {
  clock(t);
  const refresh = deferred();
  const h = harness({ send: () => reply({}, 401), refreshSession: () => refresh.promise });
  const rejected = assert.rejects(h.run(), { failure: 'network', signedOut: false });
  await flush();
  assert.equal(h.refreshes(), 1);
  h.controller.abort();
  await rejected;
  refresh.resolve({ data: { session: session('A', 'offline-fresh') }, error: null });
  await flush();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.uploads, []);
});

test('missing or foreign refreshed sessions cannot authorize an old owner mutation', async () => {
  for (const result of [
    { data: { session: null }, error: null },
    { data: { session: session('B', 'offline-fresh') }, error: null },
    { data: { session: null }, error: new AuthApiError('private-info', 401, 'bad_jwt') },
  ]) {
    const h = harness({ send: () => reply({}, 401), refreshSession: async () => result });
    await assert.rejects(h.run(), { failure: 'session', signedOut: true });
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.uploads, []);
    assert.deepEqual(h.removed, []);
  }
});

test('caller abort stops the native transfer without starting reservation cancellation or remote deletion', async t => {
  clock(t);
  const h = harness({
    upload: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Upload cancelled')), { once: true });
    }),
  });
  const rejected = assert.rejects(h.run(), { message: 'Upload cancelled' });
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.uploads.length, 1);
  h.controller.abort();
  await rejected;
  assert.equal(h.uploads[0].signal.aborted, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.finishing(), 0);
  assert.deepEqual(h.removed, []);
});

test('a refused native transfer holds its reservation instead of starting a DELETE or blocking on cleanup', async t => {
  clock(t);
  const h = harness({
    upload: async () => ({ status: 500 }),
  });
  await assert.rejects(h.run(), { failure: 'server', retryable: true });
  assert.equal(h.requests.length, 1);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.authReads(), 1);
  assert.equal(h.finishing(), 0);
  t.mock.timers.tick(timeout);
  await flush();
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests.every(request => request.method === 'POST'));
  assert.deepEqual(h.removed, []);
});

test('native 200MB photo transfer has no JSON deadline and can finish after two minutes', async t => {
  clock(t);
  const transfer = deferred();
  const h = harness({ upload: () => transfer.promise });
  let completed = false;
  const run = h.run().then(result => { completed = true; return result; });
  await flush();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.requests.length, 1);
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(completed, false);
  assert.equal(h.uploads[0].signal.aborted, false);
  transfer.resolve({ status: 200 });
  assert.equal(await run, 'done');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].body.clientUploadId, undefined);
  assert.equal(h.requests[0].body.clientUploadId, h.item.id);
  assert.equal(h.requests[1].body.uploadSessionId, reservation.uploadSessionId);
});

test('an already cancelled upload neither reads auth nor sends cleanup/network requests', async () => {
  const h = harness();
  h.controller.abort();
  await assert.rejects(h.run(), { failure: 'network', signedOut: false });
  assert.equal(h.authReads(), 0);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.uploads, []);
  assert.deepEqual(h.removed, []);
});

test('invalid/null/non-object success JSON is a non-retryable server error with no resend or cleanup', async () => {
  for (const body of ['{broken', 'null', '[]', '"unexpected"']) {
    const h = harness({ send: () => new Response(body, { status: 200 }) });
    await assert.rejects(h.run(), { failure: 'server', retryable: false, signedOut: false });
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.staged, []);
    assert.deepEqual(h.uploads, []);
    assert.deepEqual(h.removed, []);
  }
});

test('malformed R2 finalize success JSON never resends or cancels possibly accepted stored bytes', async () => {
  for (const body of ['{broken', 'null', '[]', '"unexpected"']) {
    const h = harness({ send: request => request.url.endsWith('/upload-url') ?
      reply(reservation) : new Response(body, { status: 200 }) });
    await assert.rejects(h.run(), { failure: 'server', retryable: false, signedOut: false });
    assert.equal(h.requests.length, 2);
    assert.equal(h.uploads.length, 1);
    assert.equal(h.finishing(), 1);
    assert.ok(h.requests.every(request => request.method === 'POST'));
    assert.deepEqual(h.staged, []);
    assert.deepEqual(h.removed, []);
  }
});

test('an interrupted body is retryable network failure without retaining raw transport messages', async () => {
  const h = harness({ send: () => {
    const response = reply({ success: true });
    response.text = async () => { throw new TypeError('private-info https://signed.invalid'); };
    return response;
  } });
  await assert.rejects(h.run(), networkFailure);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.removed, []);
});

test('malformed HTTP 5xx retains the existing retryable server policy rather than authorizing cleanup', async () => {
  const h = harness({ send: () => new Response('<html>offline unavailable</html>', { status: 503 }) });
  await assert.rejects(h.run(), { failure: 'server', retryable: true });
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.removed, []);
});

test('a timed-out R2 finalization never cancels a reservation containing stored bytes', async t => {
  clock(t);
  const h = harness({ send: request => request.url.endsWith('/upload-url') ? reply(reservation) : pending() });
  const rejected = assert.rejects(h.run(), networkFailure);
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.finishing(), 1);
  t.mock.timers.tick(timeout);
  await rejected;
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(request => request.method === 'POST'));
  assert.deepEqual(h.removed, []);
});

test('one authoritative 401 refreshes only the same owner token and resends the identical reservation once', async () => {
  let reservations = 0;
  const h = harness({ send: request => {
    if (request.url.endsWith('/upload-url')) {
      return ++reservations === 1 ? reply({}, 401) : reply(reservation);
    }
    return reply({ success: true });
  } });
  assert.equal(await h.run(), 'done');
  assert.equal(h.refreshes(), 1);
  assert.equal(reservations, 2);
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests[0].body, h.requests[1].body);
  assert.equal(h.requests[0].headers.Authorization, 'Bearer offline-access');
  assert.equal(h.requests[1].headers.Authorization, 'Bearer offline-fresh');
  assert.equal(h.uploads.length, 1);
});
