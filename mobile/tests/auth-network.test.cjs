/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('../node_modules/typescript');
const { GoTrueClient } = require('../node_modules/@supabase/auth-js');
const { createClient } = require('../node_modules/@supabase/supabase-js');
const { Response: NativePolyfillResponse } = require('../node_modules/whatwg-fetch');

// Installed SDK + shipped TS, with every network request mocked. No .env,
// real Supabase project, credentials, provider or production writes are used.
const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib/bounded-fetch.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', source)(moduleUnderTest, moduleUnderTest.exports);
const { createBoundedFetch, SUPABASE_REQUEST_TIMEOUT_MS } = moduleUnderTest.exports;
const flush = () => new Promise(resolve => setImmediate(resolve));
const pending = () => new Promise(() => {});

function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
}

function authClient(t, send, { expired = false } = {}) {
  const key = 'offline-auth-network-test';
  const values = new Map();
  if (expired) values.set(key, JSON.stringify({
    access_token: 'offline-expired-access', refresh_token: 'offline-refresh',
    expires_at: Math.floor(Date.now() / 1000) - 1,
    user: { id: 'offline-owner', user_metadata: {} },
  }));
  const client = new GoTrueClient({
    url: 'https://auth-test.invalid', storageKey: key,
    autoRefreshToken: true, persistSession: true, detectSessionInUrl: false,
    storage: {
      async getItem(key) { return values.get(key) ?? null; },
      async setItem(key, value) { values.set(key, value); },
      async removeItem(key) { values.delete(key); },
    },
    fetch: createBoundedFetch(send),
  });
  t.after(() => client.stopAutoRefresh());
  return { client, values, key };
}

test('expired-session bootstrap settles after one 30s black-hole request and remains recoverable', async t => {
  clock(t);
  const logged = [];
  t.mock.method(console, 'error', error => { logged.push(error.message); });
  let requests = 0, signal, resolveLate;
  const { client, values, key } = authClient(t, async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://auth-test.invalid');
    assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
    requests++; signal = init.signal;
    // Deliberately ignores abort, just like a broken transport.
    return new Promise(resolve => { resolveLate = resolve; });
  }, { expired: true });
  const restored = client.getSession();
  await flush();
  assert.equal(requests, 1);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(SUPABASE_REQUEST_TIMEOUT_MS);
  const result = await restored;
  assert.equal(signal.aborted, true);
  assert.equal(result.error.name, 'AuthRetryableFetchError');
  assert.equal(result.error.status, 0);
  assert.equal(result.data.session, null);
  assert.equal(requests, 1, 'A 30s transport deadline exhausts the SDK 30s refresh retry window');
  assert.ok(values.has(key), 'A network timeout must not destroy persisted credentials');
  assert.ok(logged.length > 0);
  assert.ok(logged.every(message => !/offline-refresh|offline-expired-access|auth-test/.test(message)));
  // A late server answer cannot rotate credentials after the caller timed out.
  resolveLate(new Response(JSON.stringify({
    access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600,
    user: { id: 'late-owner' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await flush();
  assert.equal(JSON.parse(values.get(key)).refresh_token, 'offline-refresh');
  // The SDK initialization promise is now released, rather than still blocking
  // sign-in/session calls. Its refresh cooldown also prevents a request storm.
  const retry = await client.getSession();
  assert.equal(retry.error.name, 'AuthRetryableFetchError');
  assert.equal(requests, 1);
});

test('installed auth SDK cannot hang on a stalled success JSON response body', async t => {
  clock(t);
  t.mock.method(console, 'error', () => {});
  let signal;
  const { client } = authClient(t, async (_input, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ start() {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  await client.initialize();
  const signIn = client.signInWithPassword({ email: 'test@example.invalid', password: 'offline-password' });
  await flush();
  t.mock.timers.tick(SUPABASE_REQUEST_TIMEOUT_MS);
  const result = await signIn;
  assert.equal(result.error.name, 'AuthRetryableFetchError');
  assert.equal(result.data.session, null);
  assert.equal(signal.aborted, true);
});

test('one deadline covers headers and body together, rather than restarting after fetch', async t => {
  clock(t);
  let resolveHeaders, signal;
  const send = createBoundedFetch((_input, init) => {
    signal = init.signal;
    return new Promise(resolve => { resolveHeaders = resolve; });
  });
  const request = send('https://json-test.invalid');
  const rejects = assert.rejects(request, { name: 'AbortError', message: 'Network request timed out' });
  t.mock.timers.tick(20_000);
  resolveHeaders(new Response(new ReadableStream({ start() {} }), { status: 200 }));
  await flush();
  t.mock.timers.tick(10_000);
  await rejects;
  assert.equal(signal.aborted, true);
});

test('caller abort and Request.signal settle ignored transports without exposing abort reasons', async t => {
  clock(t);
  for (const asRequest of [false, true]) {
    const caller = new AbortController();
    let signal;
    const send = createBoundedFetch(async (_input, init) => { signal = init.signal; return pending(); });
    const request = asRequest
      ? send(new Request('https://caller-test.invalid', { signal: caller.signal }))
      : send('https://caller-test.invalid', { signal: caller.signal });
    const rejects = assert.rejects(request, error => {
      assert.equal(error.name, 'AbortError');
      assert.equal(error.message, 'Network request cancelled');
      assert.doesNotMatch(error.message, /private-reason/);
      return true;
    });
    caller.abort('private-reason');
    await rejects;
    assert.equal(signal.aborted, true);
  }
});

test('already aborted calls make no request and body-stage caller abort settles too', async t => {
  clock(t);
  const caller = new AbortController();
  caller.abort();
  let requests = 0;
  const send = createBoundedFetch(async () => { requests++; return new Response('{}'); });
  await assert.rejects(send('https://caller-test.invalid', { signal: caller.signal }), { name: 'AbortError' });
  assert.equal(requests, 0);
  const reading = new AbortController();
  const body = createBoundedFetch(async () => new Response(new ReadableStream({ start() {} })));
  const waiting = body('https://body-test.invalid', { signal: reading.signal });
  const rejects = assert.rejects(waiting, { name: 'AbortError' });
  await flush();
  reading.abort();
  await rejects;
});

test('normal Response metadata, UTF-8, clones, bodyUsed and one-shot reads are preserved', async t => {
  clock(t);
  const payload = { name: 'ช่างภาพ 📸', ok: true };
  const original = new Response(JSON.stringify(payload), {
    status: 201, statusText: 'Created', headers: { 'Content-Type': 'application/json', 'X-Fixture': 'kept' },
  });
  Object.defineProperty(original, 'url', { value: 'https://json-test.invalid/final' });
  Object.defineProperty(original, 'redirected', { value: true });
  // Native and spec clones preserve their response metadata. Node's clone also
  // copies built-in internal metadata, rather than custom own-property fixtures.
  const clone = original.clone.bind(original);
  original.clone = () => {
    const response = clone();
    Object.defineProperty(response, 'url', { value: original.url });
    Object.defineProperty(response, 'redirected', { value: original.redirected });
    return response;
  };
  const requestBody = JSON.stringify({ password: 'offline-password' });
  let passed;
  const ready = await createBoundedFetch(async (_input, init) => { passed = init; return original; })(
    'https://json-test.invalid', { method: 'POST', body: requestBody, headers: { apikey: 'offline-public-key' } }
  );
  assert.equal(ready instanceof Response, true);
  assert.equal(ready.status, 201);
  assert.equal(ready.statusText, 'Created');
  assert.equal(ready.url, original.url);
  assert.equal(ready.redirected, true);
  assert.equal(ready.headers.get('X-Fixture'), 'kept');
  assert.equal(ready.bodyUsed, false);
  assert.equal(passed.body, requestBody, 'Never consume or copy request/upload data');
  assert.equal(passed.headers.apikey, 'offline-public-key');
  const other = ready.clone();
  assert.deepEqual(await ready.json(), payload);
  assert.equal(ready.bodyUsed, true);
  await assert.rejects(ready.text(), TypeError);
  assert.deepEqual(JSON.parse(await other.text()), payload);
  // A settled request has no late abort timer left behind.
  t.mock.timers.tick(SUPABASE_REQUEST_TIMEOUT_MS);
  assert.equal(passed.signal.aborted, false);
});

test('HTTP errors/empty bodies are not rewritten and installed Supabase Auth/PostgREST JSON still works', async t => {
  clock(t);
  for (const status of [204, 401, 503]) {
    const response = await createBoundedFetch(async () => new Response(status === 204 ? null : '{"error":"fixture"}', { status }))('https://json-test.invalid');
    assert.equal(response.status, status);
    assert.equal(response.ok, status === 204);
    assert.equal(await response.text(), status === 204 ? '' : '{"error":"fixture"}');
  }
  const now = Math.floor(Date.now() / 1000);
  const user = { id: 'offline-owner', user_metadata: { full_name: 'ช่างภาพ' } };
  const session = { access_token: 'offline-access', refresh_token: 'offline-refresh', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer', user };
  const supabase = createClient('https://supabase-test.invalid', 'offline-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createBoundedFetch(async (input, init) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://supabase-test.invalid');
      const payload = url.pathname === '/auth/v1/token' ? session : [{ id: 'offline-album', title: 'รูปภาพ' }];
      if (url.pathname !== '/auth/v1/token') {
        assert.equal(url.pathname, '/rest/v1/albums');
        assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer offline-access');
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) },
  });
  t.after(() => supabase.auth.stopAutoRefresh());
  const signed = await supabase.auth.signInWithPassword({ email: 'test@example.invalid', password: 'offline-password' });
  assert.equal(signed.error, null);
  assert.deepEqual(signed.data.user, user);
  const albums = await supabase.from('albums').select('id,title');
  assert.equal(albums.error, null);
  assert.deepEqual(albums.data, [{ id: 'offline-album', title: 'รูปภาพ' }]);
});

test('React Native fetch Response polyfill keeps Thai JSON and clone/metadata behavior', async t => {
  clock(t);
  const payload = { title: 'ภาพถ่าย 📸' };
  const original = new NativePolyfillResponse(JSON.stringify(payload), {
    status: 200, statusText: 'OK', url: 'https://native-test.invalid/final', headers: { 'Content-Type': 'application/json' },
  });
  const ready = await createBoundedFetch(async () => original)('https://native-test.invalid');
  assert.equal(ready instanceof NativePolyfillResponse, true);
  assert.equal(ready.url, original.url);
  assert.equal(ready.bodyUsed, false);
  const copy = ready.clone();
  assert.deepEqual(await ready.json(), payload);
  assert.deepEqual(await copy.json(), payload);
  assert.equal(ready.bodyUsed, true);
  await assert.rejects(ready.text(), TypeError);
});
