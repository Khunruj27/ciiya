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

function load({ origin = 'https://gallery.invalid', development = false, shareUrl } = {}) {
  const exports = {};
  const mocks = {
    '@/lib/config': { shareUrl: shareUrl || (token => `${origin}/share/${token}`) },
    '@/lib/data/types': types,
  };
  // No credential, Supabase, fetch, clipboard or native module is loaded here.
  vm.runInNewContext(transpile('album-delivery.ts'), {
    exports, URL, Error, __DEV__: development,
    require(name) {
      if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
      return mocks[name];
    },
  });
  return exports;
}

function album(overrides = {}) {
  return {
    id: 'owned-album', title: '  Wedding  ', shareToken: 'opaque_gallery-token_1',
    description: 'must-not-share-description', coverUrl: 'must-not-share-signed-cover',
    createdAt: '2026-10-14T00:00:00Z', photoCount: 3,
    allowDownload: true, downloadSize: 'hd', isPasswordProtected: true,
    autoFaceScan: true, autoPublish: true, ...overrides,
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides = {}, moduleOptions = {}) {
  const events = [], reads = [], shares = [], previews = [], errors = [], busy = [];
  let current = true;
  const exports = load(moduleOptions);
  const options = {
    albumId: 'owned-album',
    readAlbum: async () => album(),
    isCurrent: () => current,
    platform: 'ios',
    shareNative: async () => ({ action: 'dismissedAction' }),
    previewNative: async () => ({ type: 'cancel' }),
    makeMessage: title => `See photos from ${title}`,
    untitled: 'Untitled album',
    onBusy() {}, onError() {}, ...overrides,
  };
  const controller = exports.createAlbumDeliveryActions({
    ...options,
    readAlbum() { events.push('read'); reads.push(true); return options.readAlbum(); },
    shareNative(content) { events.push('share'); shares.push(content); return options.shareNative(content); },
    previewNative(url) { events.push('preview'); previews.push(url); return options.previewNative(url); },
    onBusy(kind) { events.push(`busy:${kind}`); busy.push(kind); options.onBusy(kind); },
    onError(kind) { events.push(`error:${kind}`); errors.push(kind); options.onError(kind); },
  });
  return { controller, events, reads, shares, previews, errors, busy,
    setCurrent(value) { current = value; } };
}

test('existing safe opaque tokens form canonical public-gallery links', () => {
  const { getAlbumDeliveryLink } = load();
  for (const token of ['a', 'ABC_def-123', 'x'.repeat(200)]) {
    assert.equal(getAlbumDeliveryLink(token), `https://gallery.invalid/share/${token}`);
  }
});

test('copy, QR preview and QR export each read fresh owner details and hand off only the canonical gallery URL', async () => {
  for (const kind of ['copy', 'qr', 'download-qr']) {
    const links = [], successes = [];
    const h = harness({
      readAlbum: async () => album({ shareToken: 'fresh-public-token', password: 'private-password', accessToken: 'private-auth' }),
      copyNative: async (link, current) => { assert.ok(current()); links.push(link); return true; },
      showQr: async (link, current) => { assert.ok(current()); links.push(link); },
      downloadQrNative: async (link, current) => { assert.ok(current()); links.push(link); },
      onCopied: link => successes.push(link),
    });
    await h.controller.run(kind);
    assert.equal(h.reads.length, 1);
    assert.deepEqual(links, ['https://gallery.invalid/share/fresh-public-token']);
    assert.equal(successes.length, kind === 'copy' ? 1 : 0);
    assert.equal(h.shares.length, 0);
    assert.equal(h.previews.length, 0);
    assert.deepEqual(h.busy, [kind, null]);
  }
});

test('copy/export/QR settings or token changes require a new review tap and never use the cached token', async () => {
  for (const kind of ['copy', 'qr', 'download-qr']) {
    let reviewed = album();
    const latest = album({ shareToken: 'rotated-token', isPasswordProtected: false });
    const handoffs = [];
    const h = harness({
      readAlbum: async () => latest,
      getReviewedAlbum: () => reviewed,
      onReviewUpdated: next => { reviewed = next; },
      copyNative: async link => { handoffs.push(link); return true; },
      showQr: async link => { handoffs.push(link); },
      downloadQrNative: async link => { handoffs.push(link); },
    });
    await h.controller.run(kind);
    assert.deepEqual(handoffs, []);
    assert.deepEqual(h.errors, ['settings-changed']);
    await h.controller.run(kind);
    assert.deepEqual(handoffs, ['https://gallery.invalid/share/rotated-token']);
  }
});

test('all new actions reject failed reads, foreign albums and missing fresh tokens before any handoff', async () => {
  for (const kind of ['copy', 'qr', 'download-qr']) {
    for (const response of [async () => { throw new types.DataError('network'); },
      async () => album({ id: 'foreign-album' }), async () => album({ shareToken: null })]) {
      let handoffs = 0;
      const h = harness({ readAlbum: response, copyNative: async () => { handoffs++; return true; },
        showQr: async () => { handoffs++; }, downloadQrNative: async () => { handoffs++; } });
      await h.controller.run(kind);
      assert.equal(handoffs, 0);
      assert.equal(h.errors.length, 1);
    }
  }
});

test('a pending copy blocks shares, QR previews and exports synchronously, including dispose/reactivation', async () => {
  const wait = deferred();
  let copyCount = 0, otherCount = 0, copiedUi = 0;
  const h = harness({ copyNative: () => { copyCount++; return wait.promise; },
    showQr: async () => { otherCount++; }, downloadQrNative: async () => { otherCount++; }, onCopied: () => { copiedUi++; } });
  const pending = h.controller.run('copy');
  await flush();
  h.controller.dispose(); h.controller.activate();
  await Promise.all(['copy', 'share', 'preview', 'qr', 'download-qr'].map(kind => h.controller.run(kind)));
  assert.equal(h.reads.length, 1);
  assert.equal(copyCount, 1);
  assert.equal(otherCount, 0);
  wait.resolve(true);
  await pending;
  assert.equal(copiedUi, 0, 'An already accepted clipboard write cannot be recalled, but its stale UI is suppressed');
});

test('new action predicates expire during deferred module/native work; only a fresh copy can display copied UI', async () => {
  for (const kind of ['copy', 'qr', 'download-qr']) {
    const wait = deferred();
    let handedOff = 0, copiedUi = 0;
    const port = async (_url, current) => { await wait.promise; if (current()) handedOff++; return current(); };
    const h = harness({ copyNative: port, showQr: port, downloadQrNative: port, onCopied: () => { copiedUi++; } });
    const pending = h.controller.run(kind);
    await flush();
    h.controller.dispose(); h.controller.activate();
    wait.resolve();
    await pending;
    assert.equal(handedOff, 0);
    assert.equal(copiedUi, 0);
  }
});

test('missing ports, false clipboard results and native failures show only generic unavailable errors, without automatic retry', async () => {
  for (const kind of ['copy', 'qr', 'download-qr']) {
    for (const port of [undefined, async () => { throw Error('private-native-error'); }]) {
      let copiedUi = 0;
      const h = harness({ copyNative: port, showQr: port, downloadQrNative: port, onCopied: () => { copiedUi++; } });
      await h.controller.run(kind);
      assert.deepEqual(h.errors, ['unavailable']);
      assert.equal(h.reads.length, 1);
      assert.equal(copiedUi, 0);
    }
  }
  const h = harness({ copyNative: async () => false });
  await h.controller.run('copy');
  assert.deepEqual(h.errors, ['unavailable']);
});

test('unknown action kinds cannot trigger a read or fall through to preview', async () => {
  const h = harness();
  await h.controller.run('unknown-kind');
  assert.equal(h.reads.length, 0);
  assert.equal(h.previews.length, 0);
  assert.equal(h.busy.length, 0);
});

test('missing, malformed, oversized and URL-like tokens cannot create delivery links', () => {
  const { getAlbumDeliveryLink } = load();
  for (const token of [null, undefined, '', ' ', 'a b', 'a/b', '..', 'a?auth=secret',
    'a#password', 'a%2Fb', 'a\\b', 'a\n', 'ภาพ', 'https://other.invalid', 'x'.repeat(201), 1, {}]) {
    assert.equal(getAlbumDeliveryLink(token), null);
  }
});

test('malformed configured origins fail closed without repairs or extra private URL components', () => {
  for (const origin of ['javascript:alert(1)', 'exp://ciiya', 'ftp://gallery.invalid',
    'https://name:secret@gallery.invalid', 'https://gallery.invalid?auth=secret',
    'https://gallery.invalid#password', 'https://gallery.invalid/base',
    'https://gallery.invalid/../', 'https://gallery.invalid/..',
    ' https://gallery.invalid', 'https://gallery.invalid\n', 'https:\\\\gallery.invalid',
    'http://gallery.invalid', 'http://localhost.evil.invalid', 'http://127.0.0.2']) {
    assert.equal(load({ origin, development: true }).getAlbumDeliveryLink('token'), null, origin);
  }
  assert.equal(load({ shareUrl() { throw Error('private config'); } }).getAlbumDeliveryLink('token'), null);
  assert.equal(load({ shareUrl: () => null }).getAlbumDeliveryLink('token'), null);
});

test('plain HTTP is limited to explicit localhost development, never production', () => {
  for (const origin of ['http://localhost:8081', 'http://127.0.0.1:3000']) {
    assert.equal(load({ origin, development: true }).getAlbumDeliveryLink('token'), `${origin}/share/token`);
    assert.equal(load({ origin, development: false }).getAlbumDeliveryLink('token'), null);
  }
});

test('creation, activation and disposal never read albums or start external activity', async () => {
  const h = harness();
  h.controller.activate();
  h.controller.dispose();
  h.controller.activate();
  await flush();
  assert.equal(h.reads.length, 0);
  assert.equal(h.shares.length, 0);
  assert.equal(h.previews.length, 0);
});

test('every intentional action reads the latest owned album instead of retaining a prior token/title', async () => {
  const rows = [album(), album({ title: 'Updated event', shareToken: 'rotated_token' })];
  const h = harness({ readAlbum: async () => rows.shift() });
  await h.controller.run('share');
  await h.controller.run('share');
  assert.equal(h.reads.length, 2);
  assert.equal(h.shares[0].url, 'https://gallery.invalid/share/opaque_gallery-token_1');
  assert.equal(h.shares[1].url, 'https://gallery.invalid/share/rotated_token');
  assert.equal(h.shares[1].message, 'See photos from Updated event');
  assert.deepEqual(h.errors, []);
});

test('iOS shares a public URL item plus a trimmed title, never other album fields', async () => {
  const h = harness();
  await h.controller.run('share');
  assert.deepEqual(JSON.parse(JSON.stringify(h.shares)), [{
    message: 'See photos from Wedding', url: 'https://gallery.invalid/share/opaque_gallery-token_1',
  }]);
  assert.equal(JSON.stringify(h.shares).includes('must-not-share'), false);
  assert.deepEqual(h.busy, ['share', null]);
});

test('missing or malformed titles use localized untitled text', async () => {
  for (const title of [null, '', '  ', undefined, {}]) {
    const h = harness({ readAlbum: async () => album({ title }) });
    await h.controller.run('share');
    assert.equal(h.shares[0].message, 'See photos from Untitled album');
  }
});

test('Android puts the gallery URL in message and has no unsupported url item', async () => {
  const h = harness({ platform: 'android' });
  await h.controller.run('share');
  assert.equal(h.shares[0].message, 'See photos from Wedding\nhttps://gallery.invalid/share/opaque_gallery-token_1');
  assert.deepEqual(Object.keys(h.shares[0]), ['message']);
});

test('preview opens only the fresh public-gallery URL and never prepares a share message', async () => {
  const h = harness({ makeMessage() { throw Error('preview must not prepare a message'); } });
  await h.controller.run('preview');
  assert.deepEqual(h.previews, ['https://gallery.invalid/share/opaque_gallery-token_1']);
  assert.equal(h.shares.length, 0);
  assert.deepEqual(h.errors, []);
});

test('rapid duplicate and share/preview overlap lock synchronously before the first read settles', async () => {
  const request = deferred();
  const h = harness({ readAlbum: () => request.promise });
  const pending = h.controller.run('share');
  await h.controller.run('share');
  await h.controller.run('preview');
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.busy, ['share']);
  assert.equal(h.shares.length, 0);
  request.resolve(album());
  await pending;
  assert.equal(h.shares.length, 1);
  assert.equal(h.previews.length, 0);
});

test('native UI holds the flight until settled; cancellation permits only a new intentional action', async () => {
  const sheet = deferred();
  const h = harness({ shareNative: () => sheet.promise });
  const pending = h.controller.run('share');
  await flush();
  await h.controller.run('preview');
  await h.controller.run('share');
  assert.equal(h.reads.length, 1);
  assert.equal(h.shares.length, 1);
  assert.deepEqual(h.busy, ['share']);
  sheet.resolve({ action: 'dismissedAction' });
  await pending;
  assert.deepEqual(h.errors, []);
  await h.controller.run('preview');
  assert.equal(h.reads.length, 2);
  assert.equal(h.previews.length, 1);
});

test('a rejected fresh read never falls back to a previously shared token', async () => {
  let count = 0;
  const h = harness({ readAlbum: async () => {
    if (++count === 2) throw new types.DataError('network', 'must-not-share-secret-url');
    return album({ shareToken: `token_${count}` });
  } });
  await h.controller.run('share');
  await h.controller.run('share');
  assert.equal(h.shares.length, 1);
  assert.deepEqual(h.errors, ['network']);
  assert.equal(h.reads.length, 2); // Never retry automatically.
  await h.controller.run('share');
  assert.equal(h.shares[1].url, 'https://gallery.invalid/share/token_3');
});

test('data read failures expose safe error kinds only, not their raw text', async () => {
  for (const kind of ['network', 'unauthenticated', 'not-found', 'server']) {
    const h = harness({ readAlbum: async () => { throw new types.DataError(kind, 'auth-password-private-url'); } });
    await h.controller.run('preview');
    assert.deepEqual(h.errors, [kind]);
    assert.equal(h.previews.length, 0);
    assert.deepEqual(h.busy, ['preview', null]);
    assert.equal(JSON.stringify(h.errors).includes('auth-password'), false);
  }
});

test('unknown read rejection becomes server, with no leak or external action', async () => {
  const malformed = new types.DataError('server');
  malformed.kind = 'private-data-in-malformed-error';
  for (const error of [Error('private-url'), 'private-password', { message: 'private-token' }, malformed]) {
    const h = harness({ readAlbum: async () => { throw error; } });
    await h.controller.run('share');
    assert.deepEqual(h.errors, ['server']);
    assert.equal(h.shares.length, 0);
  }
});

test('wrong-album or malformed read results cannot disclose their public links', async () => {
  for (const row of [album({ id: 'another-album' }), album({ id: 'owned-album ' }), undefined, null]) {
    const h = harness({ readAlbum: async () => row });
    await h.controller.run('share');
    assert.deepEqual(h.errors, ['not-found']);
    assert.equal(h.shares.length, 0);
  }
});

test('missing or malformed fresh tokens report unavailable without creating or repairing tokens', async () => {
  for (const shareToken of [null, '', 'https://gallery.invalid/share/token', 'token/password', 'token?secret']) {
    const h = harness({ readAlbum: async () => album({ shareToken }) });
    await h.controller.run('preview');
    assert.equal(h.reads.length, 1);
    assert.deepEqual(h.errors, ['unavailable']);
    assert.equal(h.previews.length, 0);
  }
});

test('unsafe configured gallery URLs never reach either native callback', async () => {
  const h = harness({}, { origin: 'https://gallery.invalid?password=secret' });
  await h.controller.run('share');
  await h.controller.run('preview');
  assert.deepEqual(h.errors, ['unavailable', 'unavailable']);
  assert.equal(h.shares.length + h.previews.length, 0);
});

test('unfocused or signed-out contexts cannot even start the owner read', async () => {
  const h = harness();
  h.setCurrent(false);
  await h.controller.run('share');
  await h.controller.run('preview');
  assert.equal(h.reads.length, 0);
  assert.deepEqual(h.busy, []);
});

test('a context change during a read suppresses the result and all late UI effects', async () => {
  const request = deferred();
  const h = harness({ readAlbum: () => request.promise });
  const pending = h.controller.run('preview');
  h.setCurrent(false);
  request.resolve(album());
  await pending;
  assert.equal(h.previews.length, 0);
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.busy, ['preview']);
});

test('signing out and returning to the same account cannot revive an old read', async () => {
  const request = deferred();
  const h = harness({ readAlbum: () => request.promise });
  const pending = h.controller.run('share');
  h.setCurrent(false);
  h.controller.dispose();
  h.setCurrent(true);
  h.controller.activate();
  assert.deepEqual(h.busy, ['share', 'share']);
  await h.controller.run('preview');
  assert.equal(h.reads.length, 1);
  request.resolve(album());
  await pending;
  assert.equal(h.shares.length + h.previews.length, 0);
  assert.deepEqual(h.busy, ['share', 'share', null]);
});

test('StrictMode cleanup/replay accepts future taps but discards pre-cleanup reads', async () => {
  const request = deferred();
  let count = 0;
  const h = harness({ readAlbum: () => ++count === 1 ? request.promise : Promise.resolve(album()) });
  const old = h.controller.run('share');
  h.controller.dispose();
  h.controller.dispose();
  h.controller.activate();
  h.controller.activate();
  request.resolve(album());
  await old;
  assert.equal(h.shares.length, 0);
  await h.controller.run('preview');
  assert.equal(h.previews.length, 1);
  assert.equal(h.reads.length, 2);
});

test('disposed reads and their errors never update an unmounted screen', async () => {
  const request = deferred();
  const h = harness({ readAlbum: () => request.promise });
  const pending = h.controller.run('share');
  h.controller.dispose();
  request.reject(new types.DataError('network', 'private-secret'));
  await pending;
  await h.controller.run('share');
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.busy, ['share']);
  assert.equal(h.reads.length, 1);
});

test('reactivation does not surface errors from an invalidated previous context', async () => {
  const request = deferred();
  const h = harness({ readAlbum: () => request.promise });
  const pending = h.controller.run('preview');
  h.controller.dispose();
  h.controller.activate();
  request.reject(new types.DataError('unauthenticated', 'private-account'));
  await pending;
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.busy, ['preview', 'preview', null]);
});

test('native failures report unavailable, hide raw text and never retry automatically', async () => {
  for (const kind of ['share', 'preview']) {
    const fail = async () => { throw Error('private-url-password-access-token'); };
    const h = harness({ shareNative: fail, previewNative: fail });
    await h.controller.run(kind);
    assert.deepEqual(h.errors, ['unavailable']);
    assert.equal(h.reads.length, 1);
    assert.equal(h.shares.length + h.previews.length, 1);
    assert.deepEqual(h.busy, [kind, null]);
  }
});

test('dispose/activate cannot permit a second native UI while the first is unsettled', async () => {
  const sheet = deferred();
  const h = harness({ shareNative: () => sheet.promise });
  const pending = h.controller.run('share');
  await flush();
  h.controller.dispose();
  h.controller.activate();
  await h.controller.run('preview');
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.busy, ['share', 'share']);
  sheet.reject(Error('private native error after unmount'));
  await pending;
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.busy, ['share', 'share', null]);
});

test('native cancellation or success neither claim delivery nor generate any follow-up activity', async () => {
  for (const result of [{ action: 'dismissedAction' }, { action: 'sharedAction' }, { type: 'cancel' }, { type: 'opened' }]) {
    const h = harness({ shareNative: async () => result, previewNative: async () => result });
    await h.controller.run('share');
    await h.controller.run('preview');
    assert.deepEqual(h.errors, []);
    assert.equal(h.reads.length, 2);
    assert.equal(h.shares.length, 1);
    assert.equal(h.previews.length, 1);
    assert.deepEqual(h.events, ['busy:share', 'read', 'share', 'busy:null',
      'busy:preview', 'read', 'preview', 'busy:null']);
  }
});

test('context is checked at the last point before sharing, even after message preparation', async () => {
  let h;
  h = harness({ makeMessage() { h.setCurrent(false); return 'must-not-share'; } });
  await h.controller.run('share');
  assert.equal(h.shares.length, 0);
  assert.deepEqual(h.errors, []);
});

test('an onBusy context change is respected before the read, despite the synchronous lock', async () => {
  let h;
  h = harness({ onBusy(kind) { if (kind) h.setCurrent(false); } });
  await h.controller.run('preview');
  assert.equal(h.reads.length, 0);
  assert.equal(h.previews.length, 0);
});

test('each changed delivery setting requires reviewing the fresh snapshot before another intentional tap', async () => {
  for (const change of [
    { isPasswordProtected: false }, { allowDownload: false },
    { downloadSize: 'sd' }, { shareToken: 'rotated_after_review' },
  ]) {
    for (const kind of ['share', 'preview']) {
      let reviewed = album();
      const fresh = album(change), updates = [];
      const h = harness({
        readAlbum: async () => fresh,
        getReviewedAlbum: () => reviewed,
        onReviewUpdated(row) { updates.push(row); reviewed = row; },
      });
      await h.controller.run(kind);
      assert.equal(h.reads.length, 1);
      assert.equal(updates.length, 1);
      assert.equal(updates[0].shareToken, fresh.shareToken);
      assert.deepEqual(h.errors, ['settings-changed']);
      assert.equal(h.shares.length + h.previews.length, 0);
      await flush();
      assert.equal(h.reads.length, 1); // An updated review does not auto-retry.
      await h.controller.run(kind);
      assert.equal(h.reads.length, 2);
      assert.equal(h.shares.length + h.previews.length, 1);
      assert.equal(updates.length, 1);
      assert.deepEqual(h.errors, ['settings-changed']);
    }
  }
});

test('missing or foreign reviewed albums refuse delivery instead of accepting fresh settings silently', async () => {
  for (const reviewed of [null, album({ id: 'another-album' })]) {
    let updates = 0;
    const h = harness({ getReviewedAlbum: () => reviewed, onReviewUpdated() { updates++; } });
    await h.controller.run('share');
    assert.deepEqual(h.errors, [reviewed ? 'not-found' : 'unavailable']);
    assert.equal(h.shares.length, 0);
    assert.equal(updates, 0);
  }
});

test('unchanged delivery settings allow the latest title without unnecessary re-review', async () => {
  let updates = 0;
  const h = harness({
    getReviewedAlbum: () => album(),
    readAlbum: async () => album({ title: 'Updated title', photoCount: 10 }),
    onReviewUpdated() { updates++; },
  });
  await h.controller.run('share');
  assert.equal(h.shares[0].message, 'See photos from Updated title');
  assert.equal(updates, 0);
  assert.deepEqual(h.errors, []);
});

test('updated review whitelists Album fields and never copies unexpected password, hash or auth fields', async () => {
  const updates = [];
  const h = harness({
    getReviewedAlbum: () => album(),
    readAlbum: async () => album({ allowDownload: false, password: 'private-password',
      password_hash: 'private-hash', passwordHash: 'private-hash', access_token: 'private-auth',
      signedDownloadUrl: 'https://private.invalid/file?signature=secret' }),
    onReviewUpdated: row => updates.push(row),
  });
  await h.controller.run('preview');
  assert.deepEqual(Object.keys(updates[0]).sort(), Object.keys(album()).sort());
  assert.equal(JSON.stringify(updates).includes('private-'), false);
  assert.equal(h.shares.length + h.previews.length, 0);
  assert.deepEqual(h.errors, ['settings-changed']);
});

test('a context change during the reviewed snapshot callback prevents all following effects', async () => {
  let h, updates = 0;
  h = harness({
    getReviewedAlbum() { h.setCurrent(false); return album(); },
    onReviewUpdated() { updates++; },
    readAlbum: async () => album({ allowDownload: false }),
  });
  await h.controller.run('share');
  assert.equal(updates, 0);
  assert.deepEqual(h.errors, []);
  assert.equal(h.shares.length, 0);
});

test('a review-update context switch does not emit an old error or open native UI afterward', async () => {
  let h, updates = 0;
  h = harness({
    getReviewedAlbum: () => album(),
    readAlbum: async () => album({ isPasswordProtected: false }),
    onReviewUpdated() { updates++; h.controller.dispose(); h.controller.activate(); },
  });
  await h.controller.run('preview');
  assert.equal(updates, 1);
  assert.deepEqual(h.errors, []);
  assert.equal(h.previews.length, 0);
});

test('token removal updates review but cannot deliver a cached link on the next tap', async () => {
  let reviewed = album();
  const h = harness({
    getReviewedAlbum: () => reviewed,
    readAlbum: async () => album({ shareToken: null }),
    onReviewUpdated(row) { reviewed = row; },
  });
  await h.controller.run('share');
  await h.controller.run('share');
  assert.deepEqual(h.errors, ['settings-changed', 'unavailable']);
  assert.equal(h.shares.length, 0);
});
