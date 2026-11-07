/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, mocks, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, URL, Uint8Array, ...globals, require(name) {
    if (!(name in mocks)) throw Error('Unexpected dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}
const types = load('data/types.ts', {});
const delivery = load('album-delivery.ts', {
  '@/lib/config': { shareUrl: token => `https://gallery.invalid/share/${token}` },
  '@/lib/data/types': types,
}, { __DEV__: false });
const qr = load('album-qr.ts', {
  qrcode: require('qrcode/lib/browser'), './album-delivery': delivery,
});
const link = 'https://gallery.invalid/share/opaque-token';
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function harness({ available = true, clipboard = async () => true, sharing = async () => {},
  sharingAvailable = async () => true, generator = qr.createAlbumQr, write, platform = 'ios' } = {}) {
  let current = true;
  const copies = [], shares = [], files = [], directories = [], moduleChecks = [], deletions = [];
  class Directory {
    constructor(root, name) { this.uri = `${root.uri}/${name}`; directories.push(this.uri); }
    create(options) { this.options = options; }
  }
  class File {
    constructor(directory, name) { this.uri = `${directory.uri}/${name}`; this.exists = false; files.push(this); }
    create() { this.exists = true; }
    write(svg) { this.contents = svg; write?.(this); }
    delete() { assert.ok(files.includes(this)); deletions.push(this.uri); this.exists = false; }
  }
  const native = load('delivery-native.ts', {
    expo: { requireOptionalNativeModule: name => { moduleChecks.push(name); return available ? {} : null; } },
    'expo-crypto': { randomUUID: () => 'synthetic-export-id' },
    'expo-file-system': { Directory, File, Paths: { cache: { uri: 'file:///mock/cache' } } },
    'react-native': { Platform: { OS: platform } },
    './album-qr': { createAlbumQr: generator },
    'expo-clipboard': {
      setStringAsync: value => { copies.push(value); return clipboard(value); },
      getStringAsync() { throw Error('Clipboard must never be read'); },
      addClipboardListener() { throw Error('Clipboard must never be observed'); },
    },
    'expo-sharing': {
      isAvailableAsync: sharingAvailable,
      shareAsync: (uri, options) => { shares.push({ uri, options }); return sharing(uri, options); },
    },
  });
  return { native, copies, shares, files, directories, moduleChecks, deletions,
    current: () => current, invalidate: () => { current = false; } };
}

test('actual browser QR encoder creates a bounded, opaque local SVG with a white quiet zone, without DOM/TextEncoder or a QR service', async () => {
  const artifact = await qr.createAlbumQr(link);
  assert.equal(artifact.link, link);
  assert.match(artifact.svg, /<svg[^>]+width="1024"/u);
  assert.match(artifact.svg, /fill="#ffffff"/u);
  assert.match(artifact.svg, /stroke="#000000"/u);
  assert.match(artifact.svg, /viewBox="0 0 \d+ \d+"/u);
  assert.ok(artifact.svg.length < 50000);
  assert.ok(!artifact.svg.includes(link));
  assert.ok(!artifact.svg.includes('script'));
  assert.equal(decodeURIComponent(artifact.uri.split(',')[1]), artifact.svg);
  const again = await qr.createAlbumQr(link);
  assert.equal(again.svg, artifact.svg);
  assert.notEqual((await qr.createAlbumQr(`${link}-different`)).svg, artifact.svg);
});

test('QR generation rejects arbitrary, credential-bearing, signed, mismatched and malformed URLs', async () => {
  for (const invalid of ['https://other.invalid/share/token', 'https://gallery.invalid/original.jpg?signature=secret',
    'https://gallery.invalid/share/a?password=secret', 'https://gallery.invalid/share/a#token',
    'https://name:secret@gallery.invalid/share/a', 'javascript:alert(1)', 'https://gallery.invalid/share/a/b',
    'https://gallery.invalid/share/%61', `${link} `, `https://gallery.invalid/share/${'a'.repeat(201)}`]) {
    await assert.rejects(qr.createAlbumQr(invalid));
  }
});

test('old development builds report native capabilities without loading mandatory modules or mutating anything', () => {
  const h = harness({ available: false });
  const capabilities = h.native.deliveryNativeCapabilities();
  assert.equal(capabilities.copy, false);
  assert.equal(capabilities.downloadQr, false);
  assert.deepEqual(h.moduleChecks, ['ExpoClipboard', 'ExpoSharing']);
  assert.equal(h.files.length, 0);
  assert.equal(h.copies.length, 0);
  assert.equal(h.shares.length, 0);
});

test('clipboard handoff writes exactly the public URL once, never reads existing clipboard; a stale module await writes nothing', async () => {
  const h = harness();
  assert.equal(await h.native.copyGalleryLink(link, h.current), true);
  assert.deepEqual(h.copies, [link]);
  const stale = harness();
  const pending = stale.native.copyGalleryLink(link, stale.current);
  stale.invalidate();
  assert.equal(await pending, false);
  assert.equal(stale.copies.length, 0);
});

test('false clipboard results and clipboard rejection are not converted into successful copies', async () => {
  const h = harness({ clipboard: async () => false });
  assert.equal(await h.native.copyGalleryLink(link, h.current), false);
  const failed = harness({ clipboard: async () => { throw Error('synthetic native failure'); } });
  await assert.rejects(failed.native.copyGalleryLink(link, failed.current));
});

test('QR export hands only a newly created cache SVG to native save/share, with generic filename and explicit SVG type', async () => {
  const h = harness();
  await h.native.exportGalleryQr(link, h.current, 'Download QR');
  assert.equal(h.files.length, 1);
  assert.match(h.files[0].uri, /^file:\/\/\/mock\/cache\/ciiya-share-qr\/ciiya-share-qr-synthetic-export-id\.svg$/u);
  assert.match(h.files[0].contents, /^<svg/u);
  assert.equal(h.shares[0].uri, h.files[0].uri);
  assert.equal(h.shares[0].options.mimeType, 'image/svg+xml');
  assert.equal(h.shares[0].options.UTI, 'public.svg-image');
  assert.equal(h.shares[0].options.dialogTitle, 'Download QR');
  assert.equal(h.deletions.length, 0, 'Do not remove a file a recipient may still consume');
});

test('invalidated module/availability/generator awaits never create a file or open native UI', async () => {
  for (const stage of ['module', 'availability', 'generator']) {
    const wait = deferred();
    const h = harness({ sharingAvailable: stage === 'availability' ? () => wait.promise : async () => true,
      generator: stage === 'generator' ? () => wait.promise : qr.createAlbumQr });
    const pending = h.native.exportGalleryQr(link, h.current, 'Download QR');
    if (stage !== 'module') for (let i = 0; i < 8; i++) await Promise.resolve();
    h.invalidate();
    wait.resolve(stage === 'generator' ? await qr.createAlbumQr(link) : true);
    await pending;
    assert.equal(h.files.length, 0);
    assert.equal(h.shares.length, 0);
  }
});

test('unavailable sharing and a rejected generator never create an artifact or fall back to a remote service', async () => {
  for (const settings of [{ sharingAvailable: async () => false }, { generator: async () => { throw Error('synthetic'); } }]) {
    const h = harness(settings);
    await assert.rejects(h.native.exportGalleryQr(link, h.current, 'Download QR'));
    assert.equal(h.files.length, 0);
    assert.equal(h.shares.length, 0);
  }
});

test('invalidation or write failure before handoff removes only its newly generated cache artifact', async () => {
  const h = harness({ write: () => h.invalidate() });
  await h.native.exportGalleryQr(link, h.current, 'Download QR');
  assert.equal(h.shares.length, 0);
  assert.deepEqual(h.deletions, [h.files[0].uri]);
  const failed = harness({ write: () => { throw Error('write failure'); } });
  await assert.rejects(failed.native.exportGalleryQr(link, failed.current, 'Download QR'));
  assert.deepEqual(failed.deletions, [failed.files[0].uri]);
});

test('native handoff holds the promise until dismissal and makes no save/delivery claim or clipboard action', async () => {
  const wait = deferred();
  const h = harness({ sharing: () => wait.promise });
  let settled = false;
  const pending = h.native.exportGalleryQr(link, h.current, 'Download QR').then(() => { settled = true; });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(h.shares.length, 1);
  assert.equal(settled, false);
  h.invalidate();
  wait.resolve();
  await pending;
  assert.equal(h.copies.length, 0);
  assert.equal(h.deletions.length, 0);
});
