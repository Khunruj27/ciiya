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
    '@/lib/preset-release': { presetReleaseEnabled: enabled },
    '@/lib/photo-delete-release': { photoDeleteReleaseEnabled: false, isPhotoDeleteAvailable: () => false },
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

const good = { path: 'owner/album/presets/a.xmp', name: 'Warm Film', createdAt: '2026-10-15T00:00:00.000Z' };
const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>';

test('the preset release gate is open in source and independent of environment values', () => {
  for (const isDemoMode of [false, true]) {
    const exports = {};
    vm.runInNewContext(transpile('preset-release.ts'), {
      exports, require(name) { assert.equal(name, '@/lib/config'); return { isDemoMode }; },
    });
    assert.equal(exports.presetReleaseEnabled, true);
    assert.equal(exports.isPresetPickingAvailable(), true);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/lib/preset-release.ts'), 'utf8'), /process\.env|fetch\(|getSession\(/);
});

test('a closed gate refuses listing and adding before token lookup, network or timers', async () => {
  const h = liveHarness({ enabled: false, send: () => { throw Error('no'); } });
  await assert.rejects(h.liveData.fetchAlbumPresets('album'), { kind: 'server' });
  await assert.rejects(h.liveData.uploadAlbumPreset('album', { fileName: 'a.xmp', content: xmp }), { kind: 'server' });
  assert.equal(h.authCalls.length + h.requests.length + h.timers.size, 0);
});

test('listing reads the encoded album route and copies only the safe preset fields', async () => {
  const h = liveHarness({ send: () => response(200, { presets: [{ ...good, extra: 'x' }] }) });
  const presets = await h.liveData.fetchAlbumPresets('album/1');
  assert.equal(h.requests[0].url, 'https://mock.invalid/api/mobile/albums/album%2F1/presets');
  assert.equal(h.requests[0].method, 'GET');
  assert.deepEqual(JSON.parse(JSON.stringify(presets)), [good]);
});

test('malformed preset lists are server errors, never partially trusted', async () => {
  const bad = [
    {}, { presets: 'x' }, { presets: Array.from({ length: 101 }, () => good) },
    { presets: [{ ...good, path: '../a.xmp' }] }, { presets: [{ ...good, path: 'a/b.jpg' }] },
    { presets: [{ ...good, name: '' }] }, { presets: [{ ...good, createdAt: 5 }] }, { presets: [null] },
  ];
  for (const payload of bad) {
    const h = liveHarness({ send: () => response(200, payload) });
    await assert.rejects(h.liveData.fetchAlbumPresets('album'), { kind: 'server' });
  }
});

test('adding a preset posts exactly the file name and text once and returns the stored preset', async () => {
  const h = liveHarness({ send: () => response(201, { preset: good }) });
  const preset = await h.liveData.uploadAlbumPreset('album', { fileName: 'Warm.xmp', content: xmp, extra: 'no' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(h.requests[0].body), { fileName: 'Warm.xmp', content: xmp });
  assert.deepEqual(JSON.parse(JSON.stringify(preset)), good);
  for (const [status, payload, kind] of [[201, {}, 'server'], [400, { error: 'x' }, 'server'], [401, {}, 'unauthenticated'], [403, { code: 'STORAGE_LIMIT_EXCEEDED' }, 'server']]) {
    const failing = liveHarness({ send: () => response(status, payload) });
    await assert.rejects(failing.liveData.uploadAlbumPreset('album', { fileName: 'Warm.xmp', content: xmp }), { kind });
  }
});
