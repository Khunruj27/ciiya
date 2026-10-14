/* global __dirname, Buffer, URL, Response */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const nodeCrypto = require('node:crypto');
const ts = require('../node_modules/typescript');
const { createClient } = require('@supabase/supabase-js');

// Exercise the shipped TypeScript and installed auth-js, not a copy of PKCE.
// Only native modules and fetch are replaced; no real project, token or network.
function load(relative, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib', relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', source)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unmocked dependency: ${name}`);
  }, module, module.exports, { env: {
    EXPO_PUBLIC_SUPABASE_URL: 'https://pkce-test.invalid',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key',
  } });
  return module.exports;
}

function cryptoFixture() {
  const calls = { random: 0, digest: 0 };
  const module = load('pkce-crypto.ts', { 'expo-crypto': {
    CryptoDigestAlgorithm: { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' },
    getRandomValues: (bytes) => { calls.random++; return nodeCrypto.randomFillSync(bytes); },
    digest: (algorithm, bytes) => { calls.digest++; return nodeCrypto.webcrypto.subtle.digest(algorithm, bytes); },
  } });
  return { ...module, calls };
}

function nativeGlobal(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, writable: true, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  });
  return cryptoFixture();
}

function secureStoreFixture(values = new Map()) {
  const writes = [];
  let failWrites = false;
  const storage = load('secure-storage.ts', { 'expo-secure-store': {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (failWrites) throw new Error('Offline keychain write failure');
      assert.ok(Buffer.byteLength(value) <= 1800);
      writes.push(key);
      values.set(key, value);
    },
    deleteItemAsync: async (key) => { values.delete(key); },
  } }).secureStorage;
  return { storage, values, writes, failWrites: () => { failWrites = true; } };
}

const storageKey = 'ciiya-mobile-pkce-regression';
const redirect = 'ciiya://auth/callback';
const sha256 = (value) => nodeCrypto.createHash('sha256').update(value).digest('base64url');
const testUser = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated' };
function session() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: `e30.${Buffer.from(JSON.stringify({ sub: testUser.id, exp: now + 3600 })).toString('base64url')}.offline-signature`,
    refresh_token: 'offline-refresh-token', expires_in: 3600, token_type: 'bearer', user: testUser,
  };
}

function clientFixture(t, native, keychain, acceptedCodes = new Map()) {
  const requests = [];
  const mockedCreateClient = (url, key, options) => {
    assert.equal(url, 'https://pkce-test.invalid');
    assert.equal(key, 'offline-public-key');
    assert.equal(options.auth.flowType, 'pkce');
    assert.equal(options.auth.detectSessionInUrl, false);
    assert.equal(options.auth.persistSession, true);
    assert.equal(options.auth.storage, keychain.storage);
    return createClient(url, key, {
      ...options,
      auth: { ...options.auth, autoRefreshToken: false, storageKey },
      global: { fetch: async (input, options) => {
        const url = new URL(String(input));
        assert.equal(url.origin, 'https://pkce-test.invalid', 'Never call a real Supabase project');
        assert.equal(url.pathname, '/auth/v1/token');
        assert.equal(url.searchParams.get('grant_type'), 'pkce');
        assert.equal(options.method, 'POST');
        const body = JSON.parse(options.body);
        requests.push(body);
        const matches = acceptedCodes.get(body.auth_code) === sha256(body.code_verifier);
        return new Response(JSON.stringify(matches ? session() : {
          code: 'bad_code_verifier', msg: 'Offline PKCE verifier did not match',
        }), { status: matches ? 200 : 400, headers: {
          'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01',
        } });
      } },
    });
  };
  const { supabase } = load('supabase.ts', {
    '@supabase/supabase-js': { createClient: mockedCreateClient },
    'react-native': { Platform: { OS: 'ios' }, AppState: { addEventListener: () => ({ remove() {} }) } },
    '@/lib/secure-storage': { secureStorage: keychain.storage },
    '@/lib/pkce-crypto': native,
    '@/lib/config': { isDemoMode: false },
    '@/lib/bounded-fetch': { createBoundedFetch: () => () => { throw new Error('Unmocked offline auth transport'); } },
  });
  t.after(() => supabase.auth.stopAutoRefresh());
  return { supabase, requests };
}

function callbackFixture(supabase) {
  return load('auth.ts', {
    'expo-linking': { createURL: (pathname) => { assert.equal(pathname, 'auth/callback'); return redirect; } },
    'expo-web-browser': { maybeCompleteAuthSession() {}, openAuthSessionAsync: () => { throw new Error('No browser in offline callback test'); } },
    '@/lib/auth-callback': load('auth-callback.ts'),
    '@/lib/supabase': { supabase },
  });
}

test('native crypto adapter hashes RFC 7636 SHA-256 vector and preserves existing full WebCrypto', async () => {
  const native = cryptoFixture();
  const target = {};
  native.installNativePkceCrypto(target);
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const digest = await target.crypto.subtle.digest({ name: 'sha-256' }, new TextEncoder().encode(verifier));
  assert.equal(Buffer.from(digest).toString('base64url'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const random = new Uint32Array(56);
  assert.equal(target.crypto.getRandomValues(random), random);
  assert.equal(native.calls.random, 1);
  assert.ok(random.some((value) => value !== 0));
  await assert.rejects(target.crypto.subtle.digest('unknown', new Uint8Array()), /Unsupported digest/);

  const full = { crypto: nodeCrypto.webcrypto };
  const digestBefore = full.crypto.subtle.digest;
  const importKeyBefore = full.crypto.subtle.importKey;
  const randomBefore = full.crypto.getRandomValues;
  native.installNativePkceCrypto(full);
  native.installNativePkceCrypto(full);
  assert.equal(full.crypto, nodeCrypto.webcrypto);
  assert.equal(full.crypto.subtle.digest, digestBefore);
  assert.equal(full.crypto.subtle.importKey, importKeyBefore);
  assert.equal(full.crypto.getRandomValues, randomBefore);
});

test('demo clients cannot persist or auto-refresh real sessions and register no AppState listener', () => {
  for (const os of ['ios', 'android']) {
    let options;
    let createCalls = 0;
    let appStateListeners = 0;
    let storageCalls = 0;
    const storage = {
      getItem: () => { storageCalls++; throw new Error('Demo must not restore a real session'); },
      setItem: () => { storageCalls++; throw new Error('Demo must not persist a real session'); },
      removeItem: () => { storageCalls++; throw new Error('Demo must not alter a real session'); },
    };
    const stub = { auth: {
      startAutoRefresh: () => { throw new Error('Demo must not start token refresh'); },
      stopAutoRefresh: () => { throw new Error('Demo must not manage real token refresh'); },
    } };
    const { supabase } = load('supabase.ts', {
      '@supabase/supabase-js': { createClient: (url, key, config) => {
        assert.equal(url, 'https://pkce-test.invalid');
        assert.equal(key, 'offline-public-key');
        createCalls++;
        options = config;
        return stub;
      } },
      'react-native': { Platform: { OS: os }, AppState: { addEventListener: () => { appStateListeners++; } } },
      '@/lib/secure-storage': { secureStorage: storage },
      '@/lib/pkce-crypto': { installNativePkceCrypto() {} },
      '@/lib/config': { isDemoMode: true },
      '@/lib/bounded-fetch': { createBoundedFetch: () => () => { throw new Error('Demo must not use auth transport'); } },
    });
    assert.equal(supabase, stub);
    assert.equal(createCalls, 1);
    assert.equal(options.auth.persistSession, false);
    assert.equal(options.auth.autoRefreshToken, false);
    assert.equal(options.auth.detectSessionInUrl, false);
    assert.equal(appStateListeners, 0);
    assert.equal(storageCalls, 0);
  }
});

test('actual Supabase OAuth selects S256 and persists its secure random verifier in SecureStore', async (t) => {
  const native = nativeGlobal(t);
  const keychain = secureStoreFixture();
  const { supabase, requests } = clientFixture(t, native, keychain);
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect, skipBrowserRedirect: true } });
  assert.equal(error, null);
  const url = new URL(data.url);
  assert.equal(url.origin, 'https://pkce-test.invalid');
  assert.equal(url.pathname, '/auth/v1/authorize');
  assert.equal(url.searchParams.get('redirect_to'), redirect);
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  const verifier = JSON.parse(await keychain.storage.getItem(`${storageKey}-code-verifier`));
  assert.match(verifier, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.equal(url.searchParams.get('code_challenge'), sha256(verifier));
  assert.notEqual(url.searchParams.get('code_challenge'), verifier);
  assert.equal(native.calls.random, 1);
  assert.equal(native.calls.digest, 1);
  assert.ok(keychain.writes.some((key) => key.startsWith(`${storageKey}-code-verifier.slot`)));
  assert.equal(requests.length, 0, 'OAuth URL generation must not make a network request');
});

test('cold-start callback uses the persisted verifier once and cannot replay the exchanged code', async (t) => {
  const native = nativeGlobal(t);
  const firstKeychain = secureStoreFixture();
  const acceptedCodes = new Map();
  const first = clientFixture(t, native, firstKeychain, acceptedCodes);
  const { data } = await first.supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect, skipBrowserRedirect: true } });
  acceptedCodes.set('offline-auth-code', new URL(data.url).searchParams.get('code_challenge'));

  // Recreate JS state, keeping only the mocked native keychain contents.
  const secondKeychain = secureStoreFixture(firstKeychain.values);
  const cold = clientFixture(t, native, secondKeychain, acceptedCodes);
  const callback = callbackFixture(cold.supabase);
  assert.equal(await callback.completeOAuthCallback(`${redirect}?code=offline-auth-code`), true);
  assert.equal(cold.requests.length, 1);
  assert.equal(cold.requests[0].auth_code, 'offline-auth-code');
  assert.equal(sha256(cold.requests[0].code_verifier), acceptedCodes.get('offline-auth-code'));
  assert.equal(await secondKeychain.storage.getItem(`${storageKey}-code-verifier`), null);
  assert.equal((await cold.supabase.auth.getSession()).data.session.user.id, testUser.id);
  const replay = await cold.supabase.auth.exchangeCodeForSession('offline-auth-code');
  assert.equal(replay.error.name, 'AuthPKCECodeVerifierMissingError');
  assert.equal(replay.data.session, null);
  assert.equal(cold.requests.length, 1);
});

test('an unsolicited PKCE code without a local verifier fails before network and never signs in', async (t) => {
  const native = nativeGlobal(t);
  const { supabase, requests } = clientFixture(t, native, secureStoreFixture());
  const callback = callbackFixture(supabase);
  await assert.rejects(callback.completeOAuthCallback(`${redirect}?code=unsolicited-code`), { name: 'AuthPKCECodeVerifierMissingError' });
  assert.equal(requests.length, 0);
  assert.equal((await supabase.auth.getSession()).data.session, null);
});

test('a different verifier is rejected by the mock PKCE server and cannot persist a session', async (t) => {
  const native = nativeGlobal(t);
  const keychain = secureStoreFixture();
  const { supabase, requests } = clientFixture(t, native, keychain, new Map([['other-device-code', sha256('other-device-verifier')]]));
  await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect, skipBrowserRedirect: true } });
  const { data, error } = await supabase.auth.exchangeCodeForSession('other-device-code');
  assert.equal(error.code, 'bad_code_verifier');
  assert.equal(data.session, null);
  assert.equal(requests.length, 1);
  assert.equal(await keychain.storage.getItem(`${storageKey}-code-verifier`), null);
  assert.equal((await supabase.auth.getSession()).data.session, null);
});

test('callback refuses implicit bearer tokens even if a valid verifier exists', async (t) => {
  const native = nativeGlobal(t);
  const keychain = secureStoreFixture();
  const { supabase, requests } = clientFixture(t, native, keychain);
  await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect, skipBrowserRedirect: true } });
  const callback = callbackFixture(supabase);
  await assert.rejects(callback.completeOAuthCallback(`${redirect}#access_token=offline-token&refresh_token=offline-refresh`), /Unsupported authentication callback/);
  assert.equal(requests.length, 0);
  assert.equal((await supabase.auth.getSession()).data.session, null);
});

test('OAuth fails closed when secure verifier persistence fails', async (t) => {
  const native = nativeGlobal(t);
  const keychain = secureStoreFixture();
  const { supabase, requests } = clientFixture(t, native, keychain);
  await supabase.auth.initialize();
  keychain.failWrites();
  await assert.rejects(supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect, skipBrowserRedirect: true } }), /keychain write failure/);
  assert.equal(requests.length, 0);
  assert.equal(native.calls.digest, 0, 'Never return an OAuth URL without first persisting its verifier');
  assert.equal((await supabase.auth.getSession()).data.session, null);
});
