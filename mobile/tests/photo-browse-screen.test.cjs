/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, mocks = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require(name) {
    if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}
const types = load('lib/data/types.ts');
const browse = load('lib/data/photo-browse.ts');
const dictionary = load('lib/i18n.ts', {
  '@/ctx/language': { useLanguage: () => null },
  '@/lib/language-preference': load('lib/language-preference.ts'),
  'expo-localization': { getLocales: () => [{ languageCode: 'th' }] }, '@/lib/data/types': types,
});
const photo = (id, filename = `File ${id}.jpg`, isReady = true) => ({ id, filename, isReady,
  thumbnailUrl: null, previewUrl: null, blurDataUrl: null, width: null, height: null, createdAt: '2026-10-14' });
const ids = photos => Array.from(photos, value => value.id);
function find(tree, match) {
  if (!tree || typeof tree !== 'object') return;
  if (match(tree)) return tree;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const result = find(child, match); if (result) return result;
  }
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  const children = tree.props?.children;
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(text).join('\n');
}
function deferred() {
  let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve };
}

// Real album TSX/filter model with keyed hook slots and feed publications.
// Every native/file/auth/server boundary is mocked; no live album/photo writes.
function harness({ locale = 'th', initialPhotos = [photo('a', 'Air 001.jpg'), photo('b', 'Pleum 002.jpg'), photo('c', 'Air 003.jpg', false)],
  cursor = 'older-page', cover } = {}) {
  const scopes = new Map(), commits = [], feeds = [], mutations = [], reads = [], navigation = [];
  let scope, childKey, epoch = 0, user = { id: 'owner-a' }, albumId = 'album-a', focused = true;
  let queryState = { data: { id: albumId, title: 'Fixture album', description: null, photoCount: 12,
    shareToken: 'fixture-link', isPasswordProtected: false }, loading: false, error: null, refreshing: false };
  const t = dictionary.getDictionary(locale);
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  function memo(factory, deps, kind) {
    const i = scope.cursors[kind]++;
    if (!scope[kind][i] || !same(scope[kind][i].deps, deps)) scope[kind][i] = { deps, value: factory() };
    return scope[kind][i].value;
  }
  function effect(callback, deps, kind) {
    const i = scope.cursors[kind]++, old = scope[kind][i], local = scope;
    if (old && same(old.deps, deps)) return;
    commits.push(() => { old?.cleanup?.(); local[kind][i] = { deps, cleanup: callback() }; });
  }
  const react = {
    useMemo: (fn, deps) => memo(fn, deps, 'memos'),
    useRef(initial) { const i = scope.cursors.refs++; return scope.refs[i] ??= { current: initial }; },
    useState(initial) {
      const i = scope.cursors.states++, local = scope;
      if (!(i in local.states)) local.states[i] = initial;
      return [local.states[i], next => { local.states[i] = typeof next === 'function' ? next(local.states[i]) : next; }];
    },
    useLayoutEffect: (fn, deps) => effect(fn, deps, 'layout'),
    useEffect: (fn, deps) => effect(fn, deps, 'effects'),
    useSyncExternalStore: (_subscribe, read) => read(),
  };
  class Feed {
    constructor() { this.snapshot = { photos: initialPhotos, nextCursor: cursor, status: 'ready', error: null, reprocessingIds: [],
      errorSource: null, loadingMore: false, refreshing: false }; this.listeners = new Set(); feeds.push(this); }
    getSnapshot = () => this.snapshot;
    subscribe = fn => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
    reload = async () => { reads.push(['reload', albumId]); };
    refreshLatest = async () => { reads.push(['latest', albumId]); };
    refreshProcessing = async () => { reads.push(['processing', albumId]); };
    loadMore = async () => { reads.push(['more', this.snapshot.nextCursor]); };
    dispose = () => { this.disposed = true; };
    publish(patch) { this.snapshot = { ...this.snapshot, ...patch }; for (const fn of this.listeners) fn(); }
  }
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const Screen = load('app/(app)/(albums)/album/[id]/index.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, react,
    'expo-image': { Image: 'Image' },
    'expo-image-picker': { launchImageLibraryAsync: async () => { throw Error('Unexpected picker'); } },
    'expo-router': { Stack: { Screen: 'Stack.Screen' }, useIsFocused: () => focused,
      useLocalSearchParams: () => ({ id: albumId }), useRouter: () => ({ push: value => navigation.push(value) }) },
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Pressable', 'RefreshControl', 'TextInput', 'View'].map(x => [x, x])),
      Alert: { alert() { throw Error('Unexpected native alert'); } },
      StyleSheet: { create: value => value, absoluteFill: {} }, useWindowDimensions: () => ({ width: 400 }) },
    '@/components/photo-viewer': { PhotoViewer: 'PhotoViewer' },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ui': Object.fromEntries(['Button', 'HeaderButton', 'LoadingView', 'Segmented', 'StateView'].map(x => [x, x])),
    '@/components/upload-banner': { UploadBanner: 'UploadBanner' },
    '@/components/upload-sheet': { UploadSheet: 'UploadSheet' },
    '@/constants/theme': { Radius: { control: 14 }, Spacing: { one: 4, two: 8, three: 16, four: 24 } },
    '@/ctx/session': { useSession: () => ({ user }) },
    '@/hooks/use-album-cover-guard': { useAlbumCoverGuard: () => {
      const renderedEpoch = epoch, local = scope;
      const capture = memo(() => () => {
        if (!local.alive || renderedEpoch !== epoch || !focused || !user) return null;
        return () => local.alive && renderedEpoch === epoch && focused && Boolean(user);
      }, [epoch], 'memos');
      return { available: Boolean(user && focused), capture };
    } },
    '@/hooks/use-query': { useQuery: () => ({ ...queryState, refresh: async () => reads.push(['album-refresh', albumId]) }) },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-uploads': { useAlbumUploads: () => ({ summary: { finished: 0 } }) },
    '@/lib/album-edit-release': { isAlbumEditingAvailable: () => true },
    '@/lib/photo-retry-release': { photoRetryReleaseEnabled: false, isPhotoRetryAvailable: () => false },
    '@/lib/preset-release': { presetReleaseEnabled: false, isPresetPickingAvailable: () => false },
    '@/lib/photo-delete-release': { photoDeleteReleaseEnabled: false, isPhotoDeleteAvailable: () => false },
    '@/lib/photo-reprocess-release': { photoReprocessReleaseEnabled: false, isPhotoReprocessAvailable: () => false },
    '@/lib/photo-bulk-delete': { MAX_PHOTO_DELETES_PER_BATCH: 100, isPhotoDeletable: () => true, async deletePhotos() { throw Error('Closed gate must not delete'); } },
    '@/components/reprocess-sheet': { ReprocessSheet: () => null },
    '@/lib/photo-reprocess': { MAX_PHOTO_REPROCESS_PER_BATCH: 100, isPhotoReprocessable: () => true, async reprocessPhotos() { throw Error('Closed gate must not reprocess'); } },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@/lib/photo-retry': { MAX_PHOTO_RETRIES_PER_TAP: 50, retryablePhotos: () => [], async retryPhotos() { throw Error('Closed retry gate must not send'); } },
    '@/lib/data': { ...types, data: {
      setAlbumCover: async (id, photoId) => { mutations.push([id, photoId]); if (cover) await cover(); },
      fetchPhotos() { throw Error('Unexpected direct read'); }, fetchPhotoUpdates() { throw Error('Unexpected direct read'); },
    } },
    '@/lib/data/types': types,
    '@/lib/data/photo-feed': { PhotoFeed: Feed }, '@/lib/data/photo-browse': browse,
    '@/lib/i18n': { ...dictionary, useT: () => t },
    '@/lib/uploads/queue': { clearFinishedUploads() { throw Error('Unexpected queue clear'); }, retryFailedUploads() { throw Error('Unexpected queue retry'); } },
  }, { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} }).default;
  function render(fn, props, key) {
    scope = scopes.get(key);
    if (!scope) { scope = { states: [], refs: [], memos: [], effects: [], layout: [], alive: true }; scopes.set(key, scope); }
    scope.cursors = { states: 0, refs: 0, memos: 0, effects: 0, layout: 0 };
    return fn(props);
  }
  function clean(local) { if (!local) return; local.alive = false;
    for (const kind of ['layout', 'effects']) for (const value of local[kind]) value?.cleanup?.(); }
  return {
    t, reads, mutations, feeds, navigation,
    render() {
      const wrapper = render(Screen, undefined, 'root');
      if (typeof wrapper.type !== 'function') return wrapper;
      if (childKey !== undefined && childKey !== wrapper.key) { clean(scopes.get(childKey)); scopes.delete(childKey); }
      childKey = wrapper.key;
      const tree = render(wrapper.type, wrapper.props, childKey);
      while (commits.length) commits.shift()();
      return tree;
    },
    wrapper() { return render(Screen, undefined, 'root'); },
    feed() { return feeds.at(-1); },
    search(value) { const tree = this.render(); find(list(tree).props.ListHeaderComponent, x => x.type === 'TextInput').props.onChangeText(value); },
    filter(value) { const tree = this.render(); find(list(tree).props.ListHeaderComponent, x => x.type === 'Segmented').props.onChange(value); },
    open(id) { const current = list(this.render()); current.props.renderItem({ item: current.props.data.find(value => value.id === id) }).props.onPress(); },
    context(nextAlbum, nextOwner) { epoch++; albumId = nextAlbum; user = nextOwner ? { id: nextOwner } : null;
      queryState = { ...queryState, data: { ...queryState.data, id: nextAlbum } }; },
    lifecycle() { epoch += 2; },
    unmount() { scopes.forEach(clean); },
  };
}
const list = tree => find(tree, x => x.type === 'FlatList');
const viewer = tree => find(tree, x => x.type === 'PhotoViewer');

test('Thai/English processing labels distinguish failures and bounded progress; unknown photos stay undiagnosed', () => {
  for (const locale of ['th', 'en']) {
    const rows = [{ ...photo('working', 'Work.jpg', false), processingStatus: 'processing', processingProgress: 45 },
      { ...photo('failed', 'Failed.jpg', false), processingStatus: 'failed', processingProgress: 99 },
      photo('legacy', 'Legacy.jpg', false)];
    const h = harness({ locale, initialPhotos: rows });
    const grid = list(h.render()), header = grid.props.ListHeaderComponent;
    assert.ok(text(header).includes(h.t.album.processingUnknown(1)));
    const working = grid.props.renderItem({ item: rows[0] });
    assert.ok(text(working).includes('45%'));
    assert.equal(working.props.accessibilityValue.now, 45);
    const failed = grid.props.renderItem({ item: rows[1] });
    assert.ok(text(failed).includes(h.t.album.processingFailed));
    assert.equal(failed.props.accessibilityValue, undefined);
    const legacy = grid.props.renderItem({ item: rows[2] });
    assert.ok(text(legacy).includes(h.t.album.filterNotReady));
    assert.equal(text(legacy).includes(h.t.album.processingFailed), false);
    h.filter('failed');
    assert.deepEqual(ids(list(h.render()).props.data), ['failed']);
    assert.deepEqual(h.mutations, []);
  }
});

test('processing read errors keep grid data and present a deliberate owner-guarded refresh', async () => {
  const h = harness();
  h.render(); h.feed().publish({ processingError: true });
  const header = list(h.render()).props.ListHeaderComponent;
  assert.ok(text(header).includes(h.t.album.processingReadFailed));
  const refresh = find(header, x => x.type === 'Button' && x.props.label === h.t.album.processingRefresh);
  await refresh.props.onPress();
  assert.ok(h.reads.some(x => x[0] === 'reload'));
  const before = h.reads.length;
  h.lifecycle(); await refresh.props.onPress();
  assert.equal(h.reads.length, before);
  assert.deepEqual(h.mutations, []);
});

test('Thai/English photo tools are local and explicitly scoped to loaded photos, not the album total', () => {
  for (const locale of ['th', 'en']) {
    const h = harness({ locale }); const tree = h.render(); const header = list(tree).props.ListHeaderComponent;
    assert.ok(text(header).includes(h.t.album.loadedSearchCount(3, 3)));
    assert.ok(text(header).includes(h.t.album.photoReadiness(2, 1)));
    assert.ok(text(header).includes(h.t.album.localSearchHint));
    assert.ok(text(header).includes(h.t.album.morePhotosHint));
    assert.equal(find(header, x => x.type === 'TextInput').props.maxLength, 200);
    assert.deepEqual(h.mutations, []); assert.deepEqual(h.navigation, []);
  }
});

test('typing and status filters change only cached grid data and do not trigger page reads or serialize a query', () => {
  const h = harness(); h.render(); const baseline = h.reads.length;
  h.search('AIR'); assert.deepEqual(ids(list(h.render()).props.data), ['a', 'c']);
  h.filter('ready'); assert.deepEqual(ids(list(h.render()).props.data), ['a']);
  assert.equal(h.reads.length, baseline); assert.deepEqual(h.mutations, []);
  assert.equal(list(h.render()).props.onEndReached, undefined);
});

test('no-match is loaded-set feedback with reset and deliberate next-page action, never automatic full-album scanning', async () => {
  const h = harness(); h.search('not found'); let current = list(h.render());
  assert.deepEqual(ids(current.props.data), []); assert.equal(current.props.onEndReached, undefined);
  assert.equal(current.props.ListEmptyComponent.props.title, h.t.album.noPhotoResults);
  const more = find(current.props.ListFooterComponent, x => x.type === 'Button');
  assert.equal(more.props.label, h.t.album.loadMorePhotos); await more.props.onPress();
  assert.deepEqual(h.reads.filter(x => x[0] === 'more'), [['more', 'older-page']]);
  current.props.ListEmptyComponent.props.onAction(); current = list(h.render());
  assert.deepEqual(ids(current.props.data), ['a', 'b', 'c']); assert.equal(typeof current.props.onEndReached, 'function');
});

test('clearing the search preserves the readiness choice; reset clears both choices', () => {
  const h = harness(); h.filter('not-ready'); h.search('air');
  let tree = h.render(); find(list(tree).props.ListHeaderComponent, x => x.props.accessibilityLabel === h.t.album.clearPhotoSearch).props.onPress();
  assert.deepEqual(ids(list(h.render()).props.data), ['c']);
  h.search('none'); tree = h.render(); list(tree).props.ListEmptyComponent.props.onAction();
  assert.deepEqual(ids(list(h.render()).props.data), ['a', 'b', 'c']);
});

test('pagination failures and no-next-page conditions retain honest search scope and intentional retry', () => {
  const h = harness(); h.search('none'); h.feed().publish({ errorSource: 'more', error: new types.DataError('network') });
  const failed = list(h.render()).props.ListFooterComponent;
  assert.equal(failed.type, 'StateView'); assert.equal(failed.props.actionLabel, h.t.common.retry);
  h.feed().publish({ nextCursor: null, errorSource: null, error: null });
  const current = list(h.render()); assert.equal(current.props.ListFooterComponent, null);
  assert.equal(text(current.props.ListHeaderComponent).includes(h.t.album.morePhotosHint), false);
});

test('filtered viewer uses the selected filtered index/count and never asks for unrelated pages', async () => {
  const h = harness(); h.search('air'); h.open('c'); const selected = viewer(h.render());
  assert.deepEqual(ids(selected.props.photos), ['a', 'c']); assert.equal(selected.props.initialIndex, 1);
  assert.equal(selected.props.total, 2); await selected.props.onEndReached();
  assert.equal(h.reads.filter(x => x[0] === 'more').length, 0);
});

test('processing completion updates previews without dropping or reordering an open not-ready pager', () => {
  const h = harness({ initialPhotos: [photo('a', 'A.jpg', false), photo('b', 'B.jpg', false)] });
  h.filter('not-ready'); h.open('a'); const before = viewer(h.render());
  const readyA = { ...photo('a', 'A.jpg'), previewUrl: 'https://mock.invalid/current-preview' };
  h.feed().publish({ photos: [photo('new', 'New.jpg', false), photo('b', 'B.jpg', false), readyA] });
  const tree = h.render(), after = viewer(tree);
  assert.deepEqual(ids(list(tree).props.data), ['new', 'b']);
  assert.deepEqual(ids(after.props.photos), ['a', 'b']); assert.equal(after.props.photos[0], readyA);
  assert.equal(after.key, before.key); assert.equal(after.props.total, 2);
});

test('a vanished frozen selection is permanently dismissed; restoring that ID does not resurrect the old viewer', () => {
  const h = harness(); h.search('air'); h.open('a'); assert.ok(viewer(h.render()));
  h.feed().publish({ photos: [photo('a', 'Air 001.jpg')] }); assert.equal(viewer(h.render()), undefined);
  h.feed().publish({ photos: [photo('a', 'Air 001.jpg'), photo('c', 'Air 003.jpg', false)] });
  assert.equal(viewer(h.render()), undefined);
});

test('queued tiles cannot open after their query changes or their latest readiness no longer matches', () => {
  const h = harness(); let current = list(h.render());
  const old = current.props.renderItem({ item: current.props.data[0] });
  h.search('pleum'); h.render(); old.props.onPress(); assert.equal(viewer(h.render()), undefined);
  h.search(''); h.filter('not-ready'); current = list(h.render());
  const pending = current.props.renderItem({ item: current.props.data[0] });
  h.feed().publish({ photos: [photo('c', 'Air 003.jpg', true)] });
  pending.props.onPress(); assert.equal(viewer(h.render()), undefined);
});

test('all-photos viewer retains the existing album total and normal pagination while each new opening has its own session key', async () => {
  const h = harness(); h.open('b'); const first = viewer(h.render());
  assert.equal(first.props.total, 12); assert.deepEqual(ids(first.props.photos), ['a', 'b', 'c']);
  await first.props.onEndReached(); assert.equal(h.reads.filter(x => x[0] === 'more').length, 1);
  first.props.onClose(); h.open('a'); const next = viewer(h.render());
  assert.notEqual(next.key, first.key); assert.equal(next.props.initialIndex, 0);
});

test('account/album replacement resets browse state and disposes the old feed; old scope callbacks are fenced', () => {
  const h = harness(); const firstKey = h.wrapper().key; h.search('air'); const oldFeed = h.feed();
  const old = list(h.render()).props.renderItem({ item: photo('a', 'Air 001.jpg') });
  h.context('album-b', 'owner-b'); assert.notEqual(h.wrapper().key, firstKey);
  const tree = h.render(); assert.equal(oldFeed.disposed, true);
  assert.equal(find(list(tree).props.ListHeaderComponent, x => x.type === 'TextInput').props.value, '');
  old.props.onPress(); assert.equal(viewer(h.render()), undefined);
});

test('SDK same-account leave/return closes the old viewer and stale tiles/cover callbacks do not perform writes', async () => {
  const h = harness(); h.open('a'); const old = viewer(h.render());
  h.lifecycle(); assert.equal(viewer(h.render()), undefined);
  await assert.rejects(old.props.onSetCover(photo('a')), { kind: 'unauthenticated' });
  assert.deepEqual(h.mutations, []);
});

test('closed or replaced viewer callbacks cannot set a cover, including before the replacement render commits', async () => {
  const h = harness(); h.open('a'); const old = viewer(h.render()); old.props.onClose();
  await assert.rejects(old.props.onSetCover(photo('a')), { kind: 'server' });
  h.open('b'); await assert.rejects(old.props.onSetCover(photo('a')), { kind: 'server' });
  assert.deepEqual(h.mutations, []);
});

test('an accepted in-flight cover retains its original ID but does not refresh a closed/replaced viewer context', async () => {
  const finish = deferred(); const h = harness({ cover: () => finish.promise });
  h.open('a'); const active = viewer(h.render()); const pending = active.props.onSetCover(photo('a'));
  active.props.onClose(); finish.resolve(); await pending;
  assert.deepEqual(h.mutations, [['album-a', 'a']]);
  assert.equal(h.reads.filter(x => x[0] === 'album-refresh').length, 0);
});

test('cover editing still reaches only an active ready photo, never a not-ready or outside-frozen-set ID', async () => {
  const h = harness(); h.search('air'); h.open('a'); const active = viewer(h.render());
  await assert.rejects(active.props.onSetCover(photo('c', 'Air 003.jpg', false)), { kind: 'server' });
  await assert.rejects(active.props.onSetCover(photo('b')), { kind: 'server' });
  await active.props.onSetCover(photo('a'));
  assert.deepEqual(h.mutations, [['album-a', 'a']]);
});
