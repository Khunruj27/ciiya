/* global __dirname */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const xcodeRequire = createRequire(require.resolve('xcode'));
const queryStringRequire = createRequire(require.resolve('query-string'));

test('physical-device debug builds include the SDK-compatible development launcher', () => {
  const metadata = require('../package.json');
  const bundledModules = require('expo/bundledNativeModules.json');
  const installedVersion = require('expo-dev-client/package.json').version;
  const { satisfies } = require('semver');
  assert.ok(satisfies(installedVersion, bundledModules['expo-dev-client']));
  assert.ok(satisfies(installedVersion, metadata.dependencies['expo-dev-client']));
  const { expo } = require('../app.json');
  const launcher = expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-dev-client');
  assert.ok(launcher, 'Prebuild must configure the launcher, not rely on a bare Debug bundle URL');
  assert.equal(launcher[1].launchMode, 'launcher');
  assert.equal(launcher[1].defaultLaunchURL, undefined, 'Do not persist a workstation LAN address in shared app config');
  assert.equal(expo.scheme, 'ciiya', 'Development launcher must retain the native OAuth scheme');
});

test('query-string gets a CommonJS function backed by unmodified upstream decoder 0.5.0', async () => {
  const compatPath = queryStringRequire.resolve('decode-uri-component');
  const compatRequire = createRequire(compatPath);
  const upstreamPath = compatRequire.resolve('decode-uri-component-patched');
  const upstreamMetadata = JSON.parse(readFileSync(path.join(path.dirname(upstreamPath), 'package.json'), 'utf8'));
  assert.equal(upstreamMetadata.name, 'decode-uri-component');
  assert.equal(upstreamMetadata.version, '0.5.0');
  const decode = queryStringRequire('decode-uri-component');
  assert.equal(typeof decode, 'function');
  assert.equal(decode, (await import(upstreamPath)).default);
  assert.equal(decode('%E0%B8%AA%F0%9F%98%80'), 'ส😀');
  assert.equal(decode('%C3%5A%A5'), '%C3Z%A5');
});

test('query-string parsing and serialization preserve Expo Router 57 query semantics', () => {
  const queryString = require('query-string');
  assert.deepEqual(
    { ...queryString.parse('code=synthetic-code&name=hello+world&tag=one&tag=two&empty=&missing') },
    { code: 'synthetic-code', name: 'hello world', tag: ['one', 'two'], empty: '', missing: null },
  );
  assert.equal(queryString.parse('text=%E0%B8%AA%FF').text, 'ส%FF');
  assert.equal(queryString.stringify({ code: 'synthetic-code', name: 'hello world' }, { sort: false }),
    'code=synthetic-code&name=hello%20world');
});

test('the actual Expo Router parser accepts callback codes and Unicode query values', () => {
  const { getStateFromPath } = require('expo-router/build/react-navigation/core/getStateFromPath');
  const state = getStateFromPath('/auth/callback?code=synthetic-code&name=%E0%B8%AA+photo', {
    screens: { Callback: 'auth/callback' },
  });
  assert.deepEqual(state.routes[0].params, { code: 'synthetic-code', name: 'ส photo' });
});

test('malformed percent-encoded input terminates instead of triggering exponential decoding', () => {
  // Run in a bounded child process: a vulnerable decoder must not hang the test runner.
  const script = `
    const assert = require('node:assert/strict');
    const queryString = require('query-string');
    const encoded = '%FF'.repeat(6000);
    assert.equal(queryString.parse('value=' + encoded).value, encoded);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), timeout: 5000, encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('xcode resolves the patched CommonJS uuid release', () => {
  assert.equal(xcodeRequire('uuid/package.json').version, '11.1.1');
  const uuid = xcodeRequire('uuid');
  assert.equal(typeof uuid.v4, 'function');
  assert.match(uuid.v4(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
});

test('xcode still generates valid, unique project identifiers without native generation', () => {
  const project = require('xcode').project('unused-in-memory-project.pbxproj');
  const ids = new Set();
  project.allUuids = () => Array.from(ids);
  for (let index = 0; index < 1000; index++) {
    const id = project.generateUuid();
    assert.match(id, /^[A-F0-9]{24}$/);
    assert.equal(ids.has(id), false);
    ids.add(id);
  }
  assert.equal(ids.size, 1000);
});
