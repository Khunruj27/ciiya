/* global __dirname, Buffer */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('../node_modules/typescript');

function load(relative, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib', relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unmocked dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const redirect = 'ciiya://auth/callback';
const url = `${redirect}?code=fake-pkce-code`;
const auth = load('auth-callback.ts');

test('callback accepts PKCE code in query with exact native/Expo Go target', () => {
  assert.equal(auth.readCallbackCode(url, redirect), 'fake-pkce-code');
  assert.equal(auth.readCallbackCode('exp://127.0.0.1:8081/--/auth/callback?code=fake-pkce-code',
    'exp://127.0.0.1:8081/--/auth/callback'), 'fake-pkce-code');
});

test('callback refuses unrelated origins, paths, credentials and malformed URLs', () => {
  for (const value of [url.replace('ciiya:', 'https:'), url.replace('callback', 'elsewhere'),
    url.replace('auth/', 'attacker/'), 'not a URL', url.replace('auth/', 'x@auth/')]) {
    assert.equal(auth.readCallbackCode(value, redirect), null);
  }
});

test('callback rejects provider errors, missing/duplicate codes, bearer tokens and oversized input without logging secrets', () => {
  for (const value of [`${redirect}?error=denied&error_description=private-info`, `${redirect}?code=`,
    `${url}&code=another`, `${redirect}#access_token=fake-access&refresh_token=fake-refresh`, `${url}&extra=${'a'.repeat(32768)}`]) {
    assert.throws(() => auth.readCallbackCode(value, redirect), (error) => {
      assert.doesNotMatch(error.message, /private-info|fake-pkce-code|fake-access|fake-refresh/);
      return true;
    });
  }
});

test('callback browser/route/cold-start delivery exchanges a code only once', async () => {
  let calls = 0;
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const complete = auth.createCallbackCompleter(async () => { calls++; await pending; });
  const a = complete(url, redirect);
  const b = complete(url, redirect);
  assert.equal(a, b);
  resolve();
  assert.equal(await a, true);
  assert.equal(await complete(url, redirect), true);
  assert.equal(calls, 1);
  assert.equal(await complete('ciiya://other', redirect), false);
});

test('callback transient code-exchange failure can be retried', async () => {
  let calls = 0;
  const complete = auth.createCallbackCompleter(async () => { if (++calls === 1) throw new Error('mock offline'); });
  await assert.rejects(complete(url, redirect));
  assert.equal(await complete(url, redirect), true);
  assert.equal(calls, 2);
});

function storageFixture() {
  const values = new Map();
  let failAt = null;
  const storage = load('secure-storage.ts', { 'expo-secure-store': {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (key === failAt) throw new Error('mock interrupted write');
      assert.ok(Buffer.byteLength(value, 'utf8') <= 1800, `Oversized SecureStore item ${key}`);
      values.set(key, value);
    },
    deleteItemAsync: async (key) => { values.delete(key); },
  } }).secureStorage;
  return { storage, values, failOn: (key) => { failAt = key; } };
}

test('SecureStore round trips Thai/emoji in byte-bounded chunks without splitting codepoints', async () => {
  const { storage, values } = storageFixture();
  const value = JSON.stringify({ user: 'ช่างภาพ 📸'.repeat(800), access_token: 'mock-token' });
  await storage.setItem('session', value);
  assert.equal(await storage.getItem('session'), value);
  for (const [key, part] of values) if (!key.endsWith('.manifest')) assert.ok(Buffer.byteLength(part) <= 1800);
});

test('SecureStore interrupted chunk or manifest write preserves the complete old session', async () => {
  for (const failKey of ['session.slot1.1', 'session.manifest']) {
    const { storage, failOn } = storageFixture();
    const old = 'old-session'.repeat(400);
    await storage.setItem('session', old);
    failOn(failKey);
    await assert.rejects(storage.setItem('session', 'new-session'.repeat(500)));
    assert.equal(await storage.getItem('session'), old);
    failOn(null);
    await storage.setItem('session', 'new-session');
    assert.equal(await storage.getItem('session'), 'new-session');
  }
});

test('SecureStore migrates old chunks only after a successful commit', async () => {
  const { storage, values, failOn } = storageFixture();
  values.set('session.count', '2'); values.set('session.0', 'legacy-'); values.set('session.1', 'session');
  assert.equal(await storage.getItem('session'), 'legacy-session');
  failOn('session.manifest');
  await assert.rejects(storage.setItem('session', 'fresh-session'));
  assert.equal(await storage.getItem('session'), 'legacy-session');
  failOn(null);
  await storage.setItem('session', 'fresh-session');
  assert.equal(await storage.getItem('session'), 'fresh-session');
  assert.equal(values.has('session.count'), false);
});

test('SecureStore corrupt pointers or missing active chunks cannot revive legacy credentials', async () => {
  const { storage, values } = storageFixture();
  values.set('session.count', '1'); values.set('session.0', 'old-token');
  values.set('session.manifest', '{broken');
  assert.equal(await storage.getItem('session'), null);
  await storage.setItem('session', 'fresh-verified-token');
  assert.equal(await storage.getItem('session'), 'fresh-verified-token');
  await storage.removeItem('session');
  values.set('session.count', '1000000000');
  assert.equal(await storage.getItem('session'), null);
  await storage.setItem('session', 'new-token');
  const manifest = JSON.parse(values.get('session.manifest'));
  values.delete(`session.slot${manifest.active}.0`);
  assert.equal(await storage.getItem('session'), null);
});

test('SecureStore serializes refreshes/removal and rejects oversized sessions before altering state', async () => {
  const { storage, values } = storageFixture();
  await Promise.all([storage.setItem('session', 'first'), storage.setItem('session', 'second')]);
  assert.equal(await storage.getItem('session'), 'second');
  await assert.rejects(storage.setItem('session', 'a'.repeat(1800 * 128 + 1)));
  assert.equal(await storage.getItem('session'), 'second');
  await Promise.all([storage.setItem('session', 'third'), storage.removeItem('session')]);
  assert.equal(await storage.getItem('session'), null);
  assert.equal(values.size, 0);
});
