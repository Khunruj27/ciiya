/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, mocks = {}, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, ...globals, require(name) {
    if (!(name in mocks)) throw new Error('Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const types = load('lib/data/types.ts');
const dictionary = load('lib/i18n.ts', {
  '@/ctx/language': { useLanguage: () => null },
  '@/lib/language-preference': load('lib/language-preference.ts'),
  'expo-localization': { getLocales: () => [{ languageCode: 'th' }] },
  '@/lib/data/types': types,
});
const delivery = load('lib/album-delivery.ts', {
  '@/lib/config': { shareUrl: token => `https://gallery.example.invalid/share/${token}` },
  '@/lib/data/types': types,
}, { URL, __DEV__: false });

function album(overrides = {}) {
  return {
    id: 'owned-album', title: '  Wedding  ', description: null, createdAt: '2026-10-14T00:00:00Z',
    coverUrl: null, photoCount: 3, shareToken: 'reviewed-public-token', allowDownload: true,
    downloadSize: 'hd', isPasswordProtected: false, autoFaceScan: true, autoPublish: true,
    ...overrides,
  };
}

function find(tree, match) {
  if (!tree || typeof tree !== 'object') return;
  if (match(tree)) return tree;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const found = find(child, match);
    if (found) return found;
  }
}

function textContent(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  const children = tree.props?.children;
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textContent).join('\n');
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  // Flush only promises. No timers, native modules, credentials or live requests.
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

const shareRoute = 'app/(app)/(albums)/album/[id]/share.tsx';
const albumRoute = 'app/(app)/(albums)/album/[id]/index.tsx';
const layoutRoute = 'app/(app)/(albums)/_layout.tsx';

// Render the actual transpiled screens and delivery controller. React's hook
// slots, dependency changes, commit effects and focus cleanup are emulated;
// native Share/WebBrowser and owner-scoped reads are strictly mocked. These are
// callback/state regressions, not an iPhone layout or native-sheet acceptance test.
function harness({ relative = shareRoute, locale = 'th', platform = 'ios', query = {}, readAlbum, share, preview,
  copy, downloadQr, createQr, capabilities = { copy: true, downloadQr: true }, demo = false } = {}) {
  const t = dictionary.getDictionary(locale);
  const nativeShares = [], nativePreviews = [], reads = [], navigation = [], refreshes = [];
  const copiedLinks = [], qrExports = [], qrLinks = [];
  const scopes = new Map(), pendingLayout = [], pendingEffects = [], pendingFocus = [];
  const authListeners = new Set();
  let scope, childKey;
  let focused = true;
  let routeId = 'owned-album';
  let sessionUser = { id: 'owner-a' };
  let authoritativeOwner = 'owner-a', actionEpoch = 0;
  let queryState = { data: album(), error: null, loading: false, refreshing: false, ...query };
  let queryFetcher;
  const sameDeps = (a, b) => a !== undefined && b !== undefined && a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  function memo(kind, factory, dependencies) {
    const index = scope.cursors[kind]++;
    const slots = scope[kind];
    if (!(index in slots) || !sameDeps(slots[index].dependencies, dependencies)) {
      slots[index] = { value: factory(), dependencies };
    }
    return slots[index].value;
  }
  function effect(kind, callback, dependencies, pending) {
    const index = scope.cursors[kind]++;
    const slots = scope[kind];
    const previous = slots[index];
    if (previous && sameDeps(previous.dependencies, dependencies)) return;
    const next = { dependencies };
    slots[index] = next;
    pending.push(() => { previous?.dispose?.(); next.dispose = callback(); });
  }
  function clean(target) {
    for (const kind of ['layout', 'effects', 'focus']) {
      target?.[kind].forEach(entry => entry.dispose?.());
    }
  }
  const create = (type, props, key) => ({ type, props, key });
  const native = {
    Platform: { OS: platform }, StyleSheet: { create: value => value, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 400, height: 800 }),
    Share: { async share(content) {
      nativeShares.push(content);
      return share ? share(content) : { action: 'sharedAction' };
    } },
    Alert: { alert() { throw new Error('Unexpected native alert'); } },
    ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Pressable', 'RefreshControl', 'ScrollView', 'Switch', 'TextInput', 'View'].map(name => [name, name])),
  };
  class FakePhotoFeed {
    constructor() {
      this.snapshot = { photos: [], status: 'ready', error: null, errorSource: null, loadingMore: false, refreshing: false, reprocessingIds: [] };
    }
    getSnapshot = () => this.snapshot;
    subscribe = () => () => {};
    reload = async () => {};
    refreshLatest = async () => {};
    refreshProcessing = async () => {};
    loadMore = async () => {};
    dispose = () => {};
  }
  const theme = { accentDeep: '#78642c', danger: '#c00' };
  const mocks = {
    'react/jsx-runtime': { jsx: create, jsxs: create },
    react: {
      useMemo: (fn, dependencies) => memo('memos', fn, dependencies),
      useCallback: (fn, dependencies) => memo('callbacks', () => fn, dependencies),
      useRef(current) { return scope.refs[scope.cursors.refs++] ??= { current }; },
      useState(initial) {
        const target = scope, index = scope.cursors.states++;
        if (!(index in target.states)) target.states[index] = typeof initial === 'function' ? initial() : initial;
        return [target.states[index], next => {
          target.states[index] = typeof next === 'function' ? next(target.states[index]) : next;
        }];
      },
      useEffect: (fn, dependencies) => effect('effects', fn, dependencies, pendingEffects),
      useLayoutEffect: (fn, dependencies) => effect('layout', fn, dependencies, pendingLayout),
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    },
    'react-native': native,
    'expo-web-browser': { WebBrowserResultType: { LOCKED: 'locked' }, async openBrowserAsync(url) {
      nativePreviews.push(url);
      return preview ? preview(url) : { type: 'cancel' };
    } },
    'expo-router': {
      Stack: { Screen: 'StackScreen' }, useIsFocused: () => focused,
      useLocalSearchParams: () => ({ id: routeId }),
      useRouter: () => Object.fromEntries(['push', 'replace', 'back'].map(kind => [kind, (...args) => navigation.push([kind, ...args])])),
      useFocusEffect(callback) {
        const index = scope.cursors.focus++;
        const previous = scope.focus[index];
        if (previous && previous.callback === callback && previous.focused === focused) return;
        const next = { callback, focused };
        scope.focus[index] = next;
        pendingFocus.push(() => { previous?.dispose?.(); if (next.focused) next.dispose = callback(); });
      },
    },
    'expo-image': { Image: 'Image' },
    'expo-image-picker': { launchImageLibraryAsync() { throw new Error('Unexpected photo picker'); } },
    '@/components/photo-viewer': { PhotoViewer: 'PhotoViewer' },
    '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/ui': Object.fromEntries(['Button', 'Card', 'HeaderButton', 'LoadingView', 'Segmented', 'StateView'].map(name => [name, name])),
    '@/components/upload-banner': { UploadBanner: 'UploadBanner' },
    '@/components/upload-sheet': { UploadSheet: 'UploadSheet' },
    '@/constants/theme': { Radius: { control: 14, card: 20, pill: 999 }, Spacing: { one: 4, two: 8, three: 16, four: 24, six: 32 } },
    '@/ctx/session': { useSession: () => ({ user: sessionUser }) },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/hooks/use-query': { useQuery(fetcher) {
      queryFetcher = fetcher;
      return { ...queryState, refresh: async () => { refreshes.push(routeId); } };
    } },
    '@/hooks/use-uploads': { useAlbumUploads: () => ({ summary: { finished: 0 } }) },
    '@/hooks/use-album-cover-guard': { useAlbumCoverGuard: (id, activeFocus) => {
      if (relative === albumRoute) return { available: false, capture: () => null };
      const renderedEpoch = actionEpoch, renderedOwner = sessionUser?.id;
      const current = () => actionEpoch === renderedEpoch && focused && id === routeId &&
        Boolean(renderedOwner && authoritativeOwner === renderedOwner);
      return { available: activeFocus && current(), capture: () => current() ? current : null };
    } },
    '@/lib/album-delivery': delivery,
    '@/lib/album-qr': { createAlbumQr: async link => {
      qrLinks.push(link);
      return createQr ? createQr(link) : { link, svg: '<svg/>', uri: 'data:image/svg+xml,test-fixture' };
    } },
    '@/lib/delivery-native': {
      deliveryNativeCapabilities: () => capabilities,
      copyGalleryLink: async (link, current) => {
        if (!current()) return false;
        copiedLinks.push(link);
        return copy ? copy(link, current) : true;
      },
      exportGalleryQr: async (link, current, title) => {
        if (!current()) return;
        qrExports.push({ link, title });
        return downloadQr?.(link, current);
      },
    },
    '@/lib/album-edit-release': { isAlbumEditingAvailable: () => false },
    '@/lib/photo-retry-release': { photoRetryReleaseEnabled: false, isPhotoRetryAvailable: () => false },
    '@/lib/preset-release': { presetReleaseEnabled: false, isPresetPickingAvailable: () => false },
    '@/lib/photo-delete-release': { photoDeleteReleaseEnabled: false, isPhotoDeleteAvailable: () => false },
    '@/lib/photo-reprocess-release': { photoReprocessReleaseEnabled: false, isPhotoReprocessAvailable: () => false },
    '@/lib/photo-bulk-delete': { MAX_PHOTO_DELETES_PER_BATCH: 100, isPhotoDeletable: () => true, async deletePhotos() { throw Error('Closed gate must not delete'); } },
    '@/components/reprocess-sheet': { ReprocessSheet: () => null },
    '@/lib/photo-reprocess': { MAX_PHOTO_REPROCESS_PER_BATCH: 100, isPhotoReprocessable: () => true, async reprocessPhotos() { throw Error('Closed gate must not reprocess'); } },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@/lib/photo-retry': { MAX_PHOTO_RETRIES_PER_TAP: 50, retryablePhotos: () => [], async retryPhotos() { throw Error('Closed retry gate must not send'); } },
    '@/lib/config': { isDemoMode: demo },
    '@/lib/supabase': { supabase: { auth: { onAuthStateChange(callback) {
      authListeners.add(callback);
      return { data: { subscription: { unsubscribe() { authListeners.delete(callback); } } } };
    } } } },
    '@/lib/data': { ...types, data: { async fetchAlbum(id) {
      reads.push(id);
      return readAlbum ? readAlbum(id) : album({ title: '  Fresh title  ' });
    } } },
    '@/lib/data/photo-feed': { PhotoFeed: FakePhotoFeed },
    '@/lib/data/types': types,
    '@/lib/data/photo-browse': load('lib/data/photo-browse.ts'),
    '@/lib/i18n': { ...dictionary, useT: () => t },
    '@/lib/uploads/queue': { clearFinishedUploads() {}, retryFailedUploads() {} },
  };
  mocks['@/components/album-delivery-panel'] = load('components/album-delivery-panel.tsx', mocks);
  const exports = load(relative, mocks);
  const ui = load('components/ui.tsx', {
    'react/jsx-runtime': mocks['react/jsx-runtime'], 'react-native': native,
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@/components/themed-text': mocks['@/components/themed-text'],
    '@/constants/theme': mocks['@/constants/theme'], '@/hooks/use-theme': mocks['@/hooks/use-theme'],
  });

  function renderComponent(fn, props, key) {
    scope = scopes.get(key);
    if (!scope) {
      scope = { refs: [], states: [], memos: [], callbacks: [], effects: [], layout: [], focus: [] };
      scopes.set(key, scope);
    }
    scope.cursors = Object.fromEntries(['refs', 'states', 'memos', 'callbacks', 'effects', 'layout', 'focus'].map(name => [name, 0]));
    return fn(props);
  }
  function commit() {
    for (const pending of [pendingLayout, pendingEffects, pendingFocus]) {
      while (pending.length) pending.shift()();
    }
  }
  return {
    t, nativeShares, nativePreviews, copiedLinks, qrExports, qrLinks, reads, navigation, refreshes, authListeners,
    renderWrapper() { return renderComponent(exports.default, undefined, 'root'); },
    render() {
      let tree = renderComponent(exports.default, undefined, 'root');
      if (typeof tree.type === 'function') {
        const nextKey = tree.key;
        if (childKey !== undefined && childKey !== nextKey) {
          clean(scopes.get(childKey));
          scopes.delete(childKey);
        }
        childKey = nextKey;
        tree = renderComponent(tree.type, tree.props, childKey);
      }
      commit();
      return tree;
    },
    renderButton(button) { return ui.Button(button.props); },
    setQuery(next) { queryState = { ...queryState, ...next }; },
    setFocused(next) { if (focused !== next) actionEpoch++; focused = next; },
    setContext(id, userId) {
      if (routeId !== id || sessionUser?.id !== userId) actionEpoch++;
      routeId = id; sessionUser = userId === null ? null : { id: userId }; authoritativeOwner = userId;
    },
    emitAuth(userId) {
      if (authoritativeOwner !== userId) actionEpoch++;
      authoritativeOwner = userId;
      for (const listener of [...authListeners]) listener('AUTH_EVENT', userId === null ? null : { user: { id: userId } });
    },
    readQuery: () => queryFetcher(),
    renderPanel(props) {
      const key = `${props.accountId}:${props.albumId}`;
      if (childKey !== undefined && childKey !== key) { clean(scopes.get(childKey)); scopes.delete(childKey); }
      childKey = key;
      const tree = renderComponent(mocks['@/components/album-delivery-panel'].AlbumDeliveryPanel, props, key);
      commit();
      return tree;
    },
    unmount() { scopes.forEach(clean); scopes.clear(); },
  };
}

function button(tree, label) {
  const result = find(tree, node => node.type === 'Button' && node.props.label === label);
  assert.ok(result, `Missing button: ${label}`);
  return result;
}

test('delivery mounts read-only and its owner-scoped query is keyed by album and account', async () => {
  const h = harness();
  const first = h.renderWrapper();
  assert.equal(first.props.albumId, 'owned-album');
  h.render();
  assert.equal(h.nativeShares.length, 0);
  assert.equal(h.nativePreviews.length, 0);
  assert.equal(h.reads.length, 0);
  await h.readQuery();
  assert.deepEqual(h.reads, ['owned-album']);
  h.setContext('owned-album', 'owner-b');
  const nextAccount = h.renderWrapper();
  assert.notEqual(nextAccount.key, first.key);
  h.setContext('other-album', 'owner-b');
  const nextAlbum = h.renderWrapper();
  assert.notEqual(nextAlbum.key, nextAccount.key);
  assert.equal(nextAlbum.props.albumId, 'other-album');
});

test('Thai/English expose copy, local QR and SVG export alongside share without automatically copying/generating/exporting', () => {
  for (const locale of ['th', 'en']) {
    const h = harness({ locale });
    const tree = h.render();
    for (const label of [h.t.delivery.share, h.t.delivery.copy, h.t.delivery.showQr, h.t.delivery.downloadQr]) {
      assert.equal(button(tree, label).props.disabled, false);
    }
    assert.ok(textContent(tree).includes(h.t.delivery.saveQrHint));
    assert.equal(h.copiedLinks.length, 0);
    assert.equal(h.qrLinks.length, 0);
    assert.equal(h.qrExports.length, 0);
    assert.equal(h.nativeShares.length, 0);
  }
});

test('copy confirms only a completed current clipboard write and never carries the copied label onto a rotated link', async () => {
  const h = harness();
  button(h.render(), h.t.delivery.copy).props.onPress();
  await settle();
  assert.deepEqual(h.copiedLinks, ['https://gallery.example.invalid/share/reviewed-public-token']);
  assert.ok(button(h.render(), h.t.delivery.copied));
  assert.equal(h.qrExports.length, 0);
  h.setQuery({ data: album({ shareToken: 'rotated-by-query' }) });
  const refreshed = h.render();
  assert.ok(button(refreshed, h.t.delivery.copy));
  assert.ok(!textContent(refreshed).includes(h.t.delivery.copied));
});

test('a false or rejected clipboard result shows a generic error, not a copied confirmation', async () => {
  for (const copy of [async () => false, async () => { throw Error('private-clipboard-error'); }]) {
    const h = harness({ copy });
    button(h.render(), h.t.delivery.copy).props.onPress();
    await settle();
    const tree = h.render();
    assert.ok(button(tree, h.t.delivery.copy));
    assert.ok(textContent(tree).includes(h.t.delivery.actionFailed));
    assert.ok(!textContent(tree).includes('private-clipboard-error'));
    assert.equal(h.copiedLinks.length, 1);
  }
});

test('old native builds disable copy/export even through retained disabled callbacks, while QR preview/share stay usable', async () => {
  const h = harness({ capabilities: { copy: false, downloadQr: false } });
  const tree = h.render();
  assert.ok(textContent(tree).includes(h.t.delivery.updatedBuildRequired));
  for (const label of [h.t.delivery.copy, h.t.delivery.downloadQr]) {
    const control = button(tree, label);
    assert.equal(control.props.disabled, true);
    control.props.onPress();
  }
  await settle();
  assert.equal(h.reads.length, 0);
  assert.equal(h.copiedLinks.length, 0);
  assert.equal(h.qrExports.length, 0);
  assert.equal(button(tree, h.t.delivery.share).props.disabled, false);
  assert.equal(button(tree, h.t.delivery.showQr).props.disabled, false);
});

test('QR preview is locally generated only after a fresh read and disappears during a failed read, blur, refresh or token rotation', async () => {
  const h = harness();
  button(h.render(), h.t.delivery.showQr).props.onPress();
  await settle();
  let tree = h.render();
  const image = find(tree, node => node.type === 'Image');
  assert.equal(image.props.source.uri, 'data:image/svg+xml,test-fixture');
  assert.equal(image.props.transition, 0);
  assert.equal(h.reads.length, 1);
  assert.equal(h.qrExports.length, 0);
  h.setQuery({ error: new types.DataError('network') });
  assert.equal(find(h.render(), node => node.type === 'Image'), undefined);
  h.setQuery({ error: null });
  tree = h.render();
  button(tree, h.t.delivery.refresh).props.onPress();
  await settle();
  assert.equal(find(h.render(), node => node.type === 'Image'), undefined);
  button(h.render(), h.t.delivery.showQr).props.onPress();
  await settle();
  h.setFocused(false); h.render(); h.setFocused(true); h.render();
  assert.equal(find(h.render(), node => node.type === 'Image'), undefined);
  button(h.render(), h.t.delivery.showQr).props.onPress();
  await settle();
  h.setQuery({ data: album({ shareToken: 'rotated' }) });
  assert.equal(find(h.render(), node => node.type === 'Image'), undefined);
});

test('QR export goes directly through the fresh-link adapter, without a preview prerequisite or a file-saved/delivered claim', async () => {
  const h = harness();
  button(h.render(), h.t.delivery.downloadQr).props.onPress();
  await settle();
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.qrExports, [{ link: 'https://gallery.example.invalid/share/reviewed-public-token', title: h.t.delivery.downloadQr }]);
  assert.equal(h.qrLinks.length, 0);
  assert.equal(h.copiedLinks.length, 0);
  assert.equal(h.nativeShares.length, 0);
  assert.ok(!textContent(h.render()).includes(h.t.delivery.copied));
});

test('all post-upload handoff buttons are disabled while one native copy/export is pending, with single-flight overlap', async () => {
  for (const kind of ['copy', 'downloadQr']) {
    const wait = deferred();
    const h = harness({ [kind]: () => wait.promise });
    const tree = h.render();
    button(tree, kind === 'copy' ? h.t.delivery.copy : h.t.delivery.downloadQr).props.onPress();
    await settle();
    const pending = h.render();
    for (const label of [h.t.delivery.share, h.t.delivery.preview, h.t.delivery.showQr]) {
      assert.equal(button(pending, label).props.disabled, true);
      button(tree, label).props.onPress();
    }
    await settle();
    assert.equal(h.reads.length, 1);
    assert.equal(h.nativeShares.length, 0);
    assert.equal(h.qrLinks.length, 0);
    wait.resolve(true);
    await settle();
  }
});

test('a QR generation completing after same-owner logout/return or blur/refocus cannot revive an old image', async () => {
  for (const transition of ['auth', 'focus']) {
    const wait = deferred();
    const h = harness({ createQr: () => wait.promise });
    button(h.render(), h.t.delivery.showQr).props.onPress();
    await settle();
    if (transition === 'auth') { h.emitAuth(null); h.emitAuth('owner-a'); h.render(); }
    else { h.setFocused(false); h.render(); h.setFocused(true); h.render(); }
    wait.resolve({ link: 'https://gallery.example.invalid/share/reviewed-public-token', svg: '<svg/>', uri: 'data:stale' });
    await settle();
    assert.equal(find(h.render(), node => node.type === 'Image'), undefined);
  }
});

test('buttons retained from a previous focus/SDK lifetime cannot start a new copy, QR preview or export after returning', async () => {
  for (const transition of ['auth', 'focus']) {
    const h = harness();
    const tree = h.render();
    if (transition === 'auth') { h.emitAuth(null); h.emitAuth('owner-a'); h.render(); }
    else { h.setFocused(false); h.render(); h.setFocused(true); h.render(); }
    for (const label of [h.t.delivery.copy, h.t.delivery.showQr, h.t.delivery.downloadQr]) button(tree, label).props.onPress();
    await settle();
    assert.equal(h.reads.length, 0);
    assert.equal(h.copiedLinks.length, 0);
    assert.equal(h.qrExports.length, 0);
    button(h.render(), h.t.delivery.copy).props.onPress();
    await settle();
    assert.equal(h.copiedLinks.length, 1);
  }
});

test('the compact upload panel exposes the same direct actions and processing caveat without nesting a ScrollView', () => {
  for (const complete of [false, true]) {
    const h = harness();
    const tree = h.renderPanel({ albumId: 'owned-album', accountId: 'owner-a', compact: true, uploadComplete: complete });
    assert.equal(tree.type, 'View');
    assert.equal(find(tree, node => node.type === 'ScrollView'), undefined);
    assert.ok(textContent(tree).includes(complete ? h.t.delivery.uploadComplete : h.t.delivery.afterUpload));
    assert.ok(textContent(tree).includes(h.t.uploads.storedHint));
    for (const label of [h.t.delivery.copy, h.t.delivery.downloadQr, h.t.delivery.share]) assert.ok(button(tree, label));
    assert.equal(h.copiedLinks.length, 0);
    assert.equal(h.qrExports.length, 0);
  }
});

test('new handoff buttons cannot use failed cached reads or absent tokens, and absent links never say copied', async () => {
  for (const query of [{ error: new types.DataError('network') }, { data: album({ shareToken: null }) }]) {
    const h = harness({ query });
    const tree = h.render();
    assert.ok(!textContent(tree).includes(h.t.delivery.copied));
    for (const label of [h.t.delivery.copy, h.t.delivery.showQr, h.t.delivery.downloadQr]) {
      const control = button(tree, label);
      assert.equal(control.props.disabled, true);
      control.props.onPress();
    }
    await settle();
    assert.equal(h.reads.length, 0);
    assert.equal(h.copiedLinks.length, 0);
    assert.equal(h.qrExports.length, 0);
  }
});

test('Thai and English show loaded password/download settings without exposing password fields', () => {
  for (const locale of ['th', 'en']) {
    const h = harness({ locale, query: { data: album({ isPasswordProtected: true, password: 'private-password-fixture' }) } });
    let tree = h.render();
    let text = textContent(tree);
    for (const copy of [h.t.delivery.intro, 'Wedding', h.t.albums.photoCount(3), h.t.delivery.password,
      h.t.delivery.protected, h.t.delivery.passwordHint, h.t.delivery.downloads, h.t.settings.sizes.hd,
      h.t.delivery.linkHint, h.t.delivery.noAutomaticSend]) assert.ok(text.includes(copy));
    assert.ok(!text.includes('private-password-fixture'));
    assert.equal(find(tree, node => node.type === 'TextInput'), undefined);
    h.setQuery({ data: album({ isPasswordProtected: false, allowDownload: false, downloadSize: 'original' }) });
    tree = h.render();
    text = textContent(tree);
    assert.ok(text.includes(h.t.delivery.unprotected));
    assert.ok(text.includes(h.t.delivery.downloadsOff));
    assert.ok(!text.includes(h.t.delivery.passwordHint));
    assert.ok(!text.includes(h.t.settings.sizes.original));
  }
});

test('only an explicit share tap reads fresh details and passes an iOS URL item without password or sent claim', async () => {
  const h = harness({ query: { data: album({ isPasswordProtected: true }) }, readAlbum: async () => album({
    title: '  Fresh title  ', isPasswordProtected: true,
    password: 'private-password-fixture',
  }) });
  const tree = h.render();
  button(tree, h.t.delivery.share).props.onPress();
  await settle();
  assert.deepEqual(h.reads, ['owned-album']);
  assert.equal(h.nativePreviews.length, 0);
  assert.equal(h.nativeShares.length, 1);
  assert.equal(h.nativeShares[0].message, h.t.album.shareMessage('Fresh title'));
  assert.equal(h.nativeShares[0].url, 'https://gallery.example.invalid/share/reviewed-public-token');
  assert.ok(!JSON.stringify(h.nativeShares).includes('private-password-fixture'));
  const after = h.render();
  assert.equal(find(after, node => node.props?.accessibilityRole === 'alert'), undefined);
  assert.equal(button(after, h.t.delivery.share).props.loading, false);
  assert.ok(textContent(after).includes(h.t.delivery.noAutomaticSend));
});

test('Android share carries the fresh public URL in message, not an unsupported URL field', async () => {
  const h = harness({ platform: 'android' });
  button(h.render(), h.t.delivery.share).props.onPress();
  await settle();
  assert.equal(h.nativeShares.length, 1);
  assert.equal(h.nativeShares[0].message,
    `${h.t.album.shareMessage('Fresh title')}\nhttps://gallery.example.invalid/share/reviewed-public-token`);
  assert.equal('url' in h.nativeShares[0], false);
});

test('preview starts only from its button, after a fresh read, using WebBrowser rather than share or navigation', async () => {
  const h = harness();
  button(h.render(), h.t.delivery.preview).props.onPress();
  await settle();
  assert.deepEqual(h.reads, ['owned-album']);
  assert.deepEqual(h.nativePreviews, ['https://gallery.example.invalid/share/reviewed-public-token']);
  assert.equal(h.nativeShares.length, 0);
  assert.equal(h.navigation.length, 0);
});

test('read failure, cached failure, loading, refreshing, wrong album and unusable tokens block both old callbacks and buttons', async () => {
  const cases = [
    { data: null, error: new types.DataError('network', 'private-auth-error-fixture') },
    { error: new types.DataError('network', 'private-auth-error-fixture') },
    { loading: true },
    { refreshing: true },
    { data: album({ id: 'foreign-album' }) },
    { data: album({ shareToken: null }) },
    { data: album({ shareToken: '../unsafe' }) },
  ];
  for (const query of cases) {
    const h = harness();
    const before = h.render();
    const oldShare = button(before, h.t.delivery.share).props.onPress;
    const oldPreview = button(before, h.t.delivery.preview).props.onPress;
    h.setQuery(query);
    const blocked = h.render();
    oldShare(); oldPreview();
    for (const label of [h.t.delivery.share, h.t.delivery.preview]) {
      const current = find(blocked, node => node.type === 'Button' && node.props.label === label);
      if (current) {
        assert.equal(current.props.disabled, true);
        const nativeButton = h.renderButton(current);
        assert.equal(nativeButton.props.disabled, true);
        assert.equal(nativeButton.props.accessibilityState.disabled, true);
        current.props.onPress();
      }
    }
    await settle();
    assert.equal(h.reads.length, 0);
    assert.equal(h.nativeShares.length, 0);
    assert.equal(h.nativePreviews.length, 0);
    assert.ok(!textContent(blocked).includes('private-auth-error-fixture'));
  }
});

test('a pending action synchronously blocks queued share/preview taps and renders disabled accessible controls', async () => {
  const request = deferred();
  const h = harness({ readAlbum: () => request.promise });
  const tree = h.render();
  const share = button(tree, h.t.delivery.share).props.onPress;
  const preview = button(tree, h.t.delivery.preview).props.onPress;
  share(); share(); preview();
  assert.deepEqual(h.reads, ['owned-album']);
  const pending = h.render();
  const nativeShare = h.renderButton(button(pending, h.t.delivery.sharing));
  assert.equal(nativeShare.props.disabled, true);
  assert.equal(nativeShare.props.accessibilityState.busy, true);
  assert.equal(nativeShare.props.accessibilityState.disabled, true);
  assert.equal(button(pending, h.t.delivery.preview).props.disabled, true);
  assert.equal(button(pending, h.t.delivery.refresh).props.disabled, true);
  request.resolve(album());
  await settle();
  assert.equal(h.nativeShares.length, 1);
  assert.equal(h.nativePreviews.length, 0);
  assert.equal(button(h.render(), h.t.delivery.share).props.disabled, false);
});

test('native-sheet dismissal does not claim delivery and an explicit next action can run once the sheet settles', async () => {
  const sheet = deferred();
  const h = harness({ share: () => sheet.promise });
  const first = h.render();
  button(first, h.t.delivery.share).props.onPress();
  await settle();
  button(first, h.t.delivery.preview).props.onPress();
  assert.equal(h.reads.length, 1);
  assert.equal(h.nativePreviews.length, 0);
  sheet.resolve({ action: 'dismissedAction' });
  await settle();
  const after = h.render();
  assert.equal(find(after, node => node.props?.accessibilityRole === 'alert'), undefined);
  assert.ok(textContent(after).includes(h.t.delivery.noAutomaticSend));
  button(after, h.t.delivery.preview).props.onPress();
  await settle();
  assert.equal(h.reads.length, 2);
  assert.equal(h.nativePreviews.length, 1);
});

test('mapped read and native failures expose only localized errors and unlock an intentional retry', async () => {
  const cases = [
    ['network', 'errorNetwork'], ['unauthenticated', 'errorSession'], ['not-found', 'errorNotFound'],
    ['server', 'errorGeneric'],
  ];
  for (const [kind, copy] of cases) {
    const h = harness({ readAlbum: async () => { throw new types.DataError(kind, 'private-url-token-fixture'); } });
    button(h.render(), h.t.delivery.share).props.onPress();
    await settle();
    const after = h.render();
    assert.equal(find(after, node => node.props?.accessibilityRole === 'alert').props.children, h.t.common[copy]);
    assert.ok(!textContent(after).includes('private-url-token-fixture'));
    assert.equal(h.nativeShares.length, 0);
    assert.equal(h.nativePreviews.length, 0);
    assert.equal(button(after, h.t.delivery.share).props.disabled, false);
  }
  for (const kind of ['share', 'preview']) {
    const failure = async () => { throw new Error('private-native-url-fixture'); };
    const h = harness({ [kind]: failure });
    button(h.render(), h.t.delivery[kind]).props.onPress();
    await settle();
    const after = h.render();
    assert.equal(find(after, node => node.props?.accessibilityRole === 'alert').props.children, h.t.delivery.actionFailed);
    assert.ok(!textContent(after).includes('private-native-url-fixture'));
    assert.equal(button(after, h.t.delivery[kind]).props.disabled, false);
  }
});

test('fresh wrong-album or missing-token responses never open external UI or reuse the cached link', async () => {
  for (const fresh of [album({ id: 'foreign-album' }), album({ shareToken: null })]) {
    const h = harness({ readAlbum: async () => fresh });
    button(h.render(), h.t.delivery.share).props.onPress();
    await settle();
    const after = h.render();
    const expected = fresh.id === 'owned-album' ? h.t.delivery.settingsChanged : h.t.common.errorNotFound;
    assert.equal(find(after, node => node.props?.accessibilityRole === 'alert').props.children, expected);
    assert.equal(h.nativeShares.length, 0);
    assert.equal(h.nativePreviews.length, 0);
  }
});

test('fresh security changes update the review first and require another explicit tap before native handoff', async () => {
  const changes = [
    { isPasswordProtected: true, password: 'private-response-password-fixture' },
    { allowDownload: false },
    { downloadSize: 'original' },
    { shareToken: 'rotated-public-token' },
  ];
  for (const change of changes) {
    for (const kind of ['share', 'preview']) {
      const latest = album({ title: 'Latest reviewed title', ...change });
      const h = harness({ readAlbum: async () => latest });
      button(h.render(), h.t.delivery[kind]).props.onPress();
      await settle();
      assert.equal(h.reads.length, 1);
      assert.equal(h.nativeShares.length, 0);
      assert.equal(h.nativePreviews.length, 0);
      const reviewed = h.render();
      const text = textContent(reviewed);
      assert.equal(find(reviewed, node => node.props?.accessibilityRole === 'alert').props.children,
        h.t.delivery.settingsChanged);
      assert.ok(text.includes('Latest reviewed title'));
      assert.ok(!text.includes('private-response-password-fixture'));
      if (change.isPasswordProtected) assert.ok(text.includes(h.t.delivery.protected));
      if (change.allowDownload === false) assert.ok(text.includes(h.t.delivery.downloadsOff));
      if (change.downloadSize) assert.ok(text.includes(h.t.settings.sizes[change.downloadSize]));
      if (change.shareToken) {
        assert.ok(text.includes(`/share/${change.shareToken}`));
        assert.ok(!text.includes('/share/reviewed-public-token'));
      }
      button(reviewed, h.t.delivery[kind]).props.onPress();
      await settle();
      assert.equal(h.reads.length, 2);
      assert.equal(h.nativeShares.length + h.nativePreviews.length, 1);
      const content = kind === 'share' ? h.nativeShares[0].url : h.nativePreviews[0];
      assert.equal(content, `https://gallery.example.invalid/share/${latest.shareToken}`);
      assert.ok(!JSON.stringify(h.nativeShares).includes('private-response-password-fixture'));
    }
  }
});

test('a successful query supersedes an action review snapshot instead of retaining outdated settings', async () => {
  const h = harness({ readAlbum: async () => album({ allowDownload: false, title: 'Action review title' }) });
  button(h.render(), h.t.delivery.share).props.onPress();
  await settle();
  assert.ok(textContent(h.render()).includes('Action review title'));
  h.setQuery({ data: album({ title: 'Latest query title', downloadSize: 'uhd' }) });
  const next = textContent(h.render());
  assert.ok(next.includes('Latest query title'));
  assert.ok(next.includes(h.t.settings.sizes.uhd));
  assert.ok(!next.includes('Action review title'));
  assert.ok(!next.includes(h.t.delivery.downloadsOff));
  assert.equal(h.nativeShares.length, 0);
});

test('a resolved locked browser result is a localized failure, not gallery-open success', async () => {
  const h = harness({ preview: async () => ({ type: 'locked' }) });
  button(h.render(), h.t.delivery.preview).props.onPress();
  await settle();
  const after = h.render();
  assert.equal(h.nativePreviews.length, 1);
  assert.equal(find(after, node => node.props?.accessibilityRole === 'alert').props.children,
    h.t.delivery.actionFailed);
  assert.equal(button(after, h.t.delivery.preview).props.disabled, false);
});

test('an SDK identity change fences captured callbacks and pending reads immediately before React rerenders', async () => {
  for (const nextOwner of [null, 'owner-b']) {
    const request = deferred();
    const h = harness({ readAlbum: () => request.promise });
    const before = h.render();
    const oldShare = button(before, h.t.delivery.share).props.onPress;
    const oldPreview = button(before, h.t.delivery.preview).props.onPress;
    oldShare();
    assert.equal(h.authListeners.size, 1);
    h.emitAuth(nextOwner);
    oldShare(); oldPreview();
    request.resolve(album());
    await settle();
    assert.equal(h.reads.length, 1);
    assert.equal(h.nativeShares.length, 0);
    assert.equal(h.nativePreviews.length, 0);
    const fenced = h.render();
    assert.equal(fenced.type, 'StateView');
    assert.equal(fenced.props.title, h.t.common.errorSession);
    assert.ok(!textContent(fenced).includes('/share/'));
    h.unmount();
    assert.equal(h.authListeners.size, 0);
  }
});

test('SDK logout and same-account return cannot revive an old read; the next explicit action reads again', async () => {
  const request = deferred();
  let attempts = 0;
  const h = harness({ readAlbum: () => ++attempts === 1 ? request.promise : Promise.resolve(album()) });
  const initial = h.render();
  const oldShare = button(initial, h.t.delivery.share).props.onPress;
  oldShare();
  h.emitAuth(null);
  h.emitAuth('owner-a');
  oldShare();
  assert.equal(attempts, 1);
  request.resolve(album());
  await settle();
  assert.equal(h.nativeShares.length, 0);
  const resumed = h.render();
  assert.equal(button(resumed, h.t.delivery.share).props.disabled, false);
  button(resumed, h.t.delivery.share).props.onPress();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(h.nativeShares.length, 1);
});

test('matching-owner SDK session refresh does not invalidate an otherwise current user action', async () => {
  const request = deferred();
  const h = harness({ readAlbum: () => request.promise });
  button(h.render(), h.t.delivery.share).props.onPress();
  h.emitAuth('owner-a');
  request.resolve(album());
  await settle();
  assert.equal(h.reads.length, 1);
  assert.equal(h.nativeShares.length, 1);
});

test('a missing account hides cached links while Demo mode never subscribes to the live auth SDK', () => {
  const signedOut = harness();
  signedOut.setContext('owned-album', null);
  const tree = signedOut.render();
  assert.equal(tree.type, 'StateView');
  assert.equal(tree.props.title, signedOut.t.common.errorSession);
  assert.equal(signedOut.reads.length, 0);
  assert.equal(find(tree, node => node.type === 'Button'), undefined);
  const demo = harness({ demo: true });
  demo.render();
  assert.equal(demo.authListeners.size, 0);
  assert.equal(demo.nativeShares.length, 0);
  assert.equal(demo.nativePreviews.length, 0);
});

test('blur and same-route refocus invalidate a pending read, and a later explicit tap uses a new read', async () => {
  const request = deferred();
  let attempts = 0;
  const h = harness({ readAlbum: () => ++attempts === 1 ? request.promise : Promise.resolve(album()) });
  const initial = h.render();
  button(initial, h.t.delivery.share).props.onPress();
  h.setFocused(false);
  const blurred = h.render();
  assert.equal(button(blurred, h.t.delivery.sharing).props.disabled, true);
  button(initial, h.t.delivery.preview).props.onPress();
  h.setFocused(true);
  h.render();
  request.resolve(album());
  await settle();
  assert.equal(h.nativeShares.length, 0);
  assert.equal(h.nativePreviews.length, 0);
  const resumed = h.render();
  assert.equal(button(resumed, h.t.delivery.share).props.disabled, false);
  button(resumed, h.t.delivery.share).props.onPress();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(h.nativeShares.length, 1);
});

test('account and route remounts dispose previous delivery actions, including queued callbacks and pending reads', async () => {
  for (const [nextId, nextOwner] of [['owned-album', 'owner-b'], ['other-album', 'owner-a']]) {
    const request = deferred();
    const h = harness({ readAlbum: () => request.promise });
    const before = h.render();
    const oldShare = button(before, h.t.delivery.share).props.onPress;
    oldShare();
    h.setContext(nextId, nextOwner);
    h.setQuery({ data: album({ id: nextId, shareToken: 'new-context-token' }) });
    const next = h.render();
    oldShare();
    request.resolve(album());
    await settle();
    assert.equal(h.nativeShares.length, 0);
    assert.equal(h.nativePreviews.length, 0);
    assert.equal(h.reads.length, 1);
    assert.equal(button(next, h.t.delivery.share).props.disabled, false);
  }
});

test('unmount invalidates pending reads and retained action callbacks', async () => {
  const request = deferred();
  const h = harness({ readAlbum: () => request.promise });
  const before = h.render();
  const oldShare = button(before, h.t.delivery.share).props.onPress;
  const oldPreview = button(before, h.t.delivery.preview).props.onPress;
  oldShare();
  h.unmount();
  oldShare(); oldPreview();
  request.resolve(album());
  await settle();
  assert.equal(h.reads.length, 1);
  assert.equal(h.nativeShares.length, 0);
  assert.equal(h.nativePreviews.length, 0);
});

test('retry and manual refresh only refresh owner-scoped details, without opening share or gallery', async () => {
  const failed = harness({ query: { data: null, error: new types.DataError('network') } });
  await find(failed.render(), node => node.type === 'StateView').props.onAction();
  assert.equal(failed.refreshes.length, 1);
  assert.equal(failed.nativeShares.length, 0);
  assert.equal(failed.nativePreviews.length, 0);
  const h = harness();
  await button(h.render(), h.t.delivery.refresh).props.onPress();
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.nativeShares.length, 0);
  assert.equal(h.nativePreviews.length, 0);
});

test('album header navigates to delivery with album ID only; it does not share a cached token directly', () => {
  const h = harness({ relative: albumRoute });
  const tree = h.render();
  const actions = find(tree, node => node.type === 'StackScreen').props.options.headerRight();
  const header = find(actions, node => node.type === 'HeaderButton' && node.props.label === h.t.album.share);
  assert.ok(header);
  header.props.onPress();
  assert.equal(h.navigation.length, 1);
  assert.equal(h.navigation[0][0], 'push');
  assert.equal(h.navigation[0][1].pathname, '/album/[id]/share');
  assert.deepEqual(Object.keys(h.navigation[0][1].params), ['id']);
  assert.equal(h.navigation[0][1].params.id, 'owned-album');
  assert.equal(h.nativeShares.length, 0);
  assert.equal(h.nativePreviews.length, 0);
  assert.equal(h.reads.length, 0);
  assert.ok(!JSON.stringify(h.navigation).includes('reviewed-public-token'));
});

test('album navigator registers a localized delivery route without requiring new native dependencies', () => {
  for (const locale of ['th', 'en']) {
    const h = harness({ relative: layoutRoute, locale });
    const route = find(h.render(), node => node.type === 'StackScreen' && node.props.name === 'album/[id]/share');
    assert.ok(route);
    assert.equal(route.props.options.title, h.t.delivery.title);
  }
  const source = fs.readFileSync(path.join(__dirname, '../src', shareRoute), 'utf8');
  assert.doesNotMatch(source, /expo-clipboard|\b(?:setAlbum|updateAlbum|createAlbum)\s*\(|password\s*:/);
});
