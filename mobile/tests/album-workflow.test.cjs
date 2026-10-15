/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, mocks = {}, suffix = '') {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source + suffix, { exports, require(name) {
    if (!(name in mocks)) throw new Error('Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const { selectAlbums } = load('lib/data/album-list.ts');
const types = load('lib/data/types.ts');
const dictionary = load('lib/i18n.ts', {
  '@/ctx/language': { useLanguage: () => null },
  '@/lib/language-preference': load('lib/language-preference.ts'),
  'expo-localization': { getLocales: () => [{ languageCode: 'th' }] },
  '@/lib/data/types': types,
});

function album(id, title, createdAt = '2026-10-11T00:00:00Z', photoCount = 0, description = null) {
  return {
    id, title, description, createdAt, photoCount, coverUrl: null, shareToken: null,
    allowDownload: true, downloadSize: 'hd', isPasswordProtected: false,
    autoFaceScan: true, autoPublish: false,
  };
}
const ids = rows => Array.from(rows, row => row.id);

test('album search supports Thai, case, equivalent Unicode, whitespace and words across title/description', () => {
  const rows = [
    album('wedding', 'Air & Pleum', undefined, 58, 'งานแต่ง เขาใหญ่'),
    album('graduation', 'งานรับปริญญา', undefined, 13),
    album('empty', null),
  ];
  for (const query of [' AIR  เขาใหญ่ ', 'ＡＩＲ\nงานแต่ง', 'pleum']) {
    assert.deepEqual(ids(selectAlbums(rows, query, 'newest', 'th')), ['wedding']);
  }
  assert.deepEqual(ids(selectAlbums(rows, 'รับปริญญา', 'newest', 'th')), ['graduation']);
  assert.equal(selectAlbums(rows, ' ', 'newest', 'th').length, 3);
  assert.equal(selectAlbums(rows, 'not found', 'newest', 'en').length, 0);
  assert.equal(selectAlbums([album('tone', 'ป่า')], 'ปา', 'newest', 'th').length, 0);
});

test('album sorts are deterministic, numeric-aware and never mutate the cached source', () => {
  const rows = Object.freeze([
    Object.freeze(album('b', 'Album 10', '2026-10-01T00:00:00Z', 10)),
    Object.freeze(album('c', 'Album 2', '2026-10-11T00:00:00Z', 2)),
    Object.freeze(album('a', 'Album 2', '2026-10-11T00:00:00Z', 2)),
    Object.freeze(album('d', 'Untitled', 'invalid', 0)),
  ]);
  assert.deepEqual(ids(selectAlbums(rows, '', 'newest', 'en')), ['a', 'c', 'b', 'd']);
  assert.deepEqual(ids(selectAlbums(rows, '', 'name', 'en')), ['a', 'c', 'b', 'd']);
  assert.deepEqual(ids(selectAlbums(rows, '', 'photos', 'en')), ['b', 'a', 'c', 'd']);
  assert.deepEqual(ids(rows), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids(selectAlbums([...rows].reverse(), '', 'photos', 'en')), ['b', 'a', 'c', 'd']);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function find(tree, match) {
  if (!tree || typeof tree !== 'object') return;
  if (match(tree)) return tree;
  for (const child of Array.isArray(tree.props?.children) ? tree.props.children : [tree.props?.children]) {
    const result = find(child, match);
    if (result) return result;
  }
}

function textContent(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  const children = tree.props?.children;
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textContent).join('\n');
}

// Exercise actual native event callbacks and queued double-taps, with all I/O
// mocked. Neither these tests nor demo fixtures read credentials or write live data.
function harness(relative, { api = {}, uploads = {}, query = {}, suffix = '', editingAvailable = true, language = 'th' } = {}) {
  const states = [], refs = [], navigation = [], alerts = [];
  const memos = [], callbacks = [], effects = [], layouts = [], focusEffects = [];
  const pendingLayout = [], pendingEffects = [], pendingFocus = [], authListeners = new Set();
  let stateCursor = 0, refCursor = 0;
  let memoCursor = 0, callbackCursor = 0, effectCursor = 0, layoutCursor = 0, focusCursor = 0;
  let focused = true, routeId = 'owned-album', user = { id: 'owner' }, queryState = query;
  let removalGuard = { enabled: false, callback: null };
  const sameDeps = (before, after) => before !== undefined && after !== undefined &&
    before.length === after.length && before.every((value, i) => Object.is(value, after[i]));
  function memoize(slots, index, factory, dependencies) {
    if (!(index in slots) || !sameDeps(slots[index].dependencies, dependencies)) {
      slots[index] = { value: factory(), dependencies };
    }
    return slots[index].value;
  }
  function enqueue(slots, index, fn, dependencies, pending) {
    const previous = slots[index];
    if (previous && sameDeps(previous.dependencies, dependencies)) return;
    const next = { dependencies };
    slots[index] = next;
    pending.push(() => { previous?.dispose?.(); next.dispose = fn(); });
  }
  const t = dictionary.getDictionary(language);
  const create = (type, props, key) => ({ type, props, key });
  const mocks = {
    'react/jsx-runtime': { jsx: create, jsxs: create },
    react: {
      useMemo: (fn, dependencies) => memoize(memos, memoCursor++, fn, dependencies),
      useCallback: (fn, dependencies) => memoize(callbacks, callbackCursor++, () => fn, dependencies),
      useEffect: (fn, dependencies) => enqueue(effects, effectCursor++, fn, dependencies, pendingEffects),
      useLayoutEffect: (fn, dependencies) => enqueue(layouts, layoutCursor++, fn, dependencies, pendingLayout),
      useRef(current) { return refs[refCursor++] ??= { current }; },
      useState(initial) {
        const slot = stateCursor++;
        if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
        return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }];
      },
    },
    'react-native': {
      Platform: { OS: 'ios' }, StyleSheet: { create: value => value },
      Alert: { alert: (...args) => alerts.push(args) },
      ...Object.fromEntries(['FlatList', 'RefreshControl', 'Pressable', 'TextInput', 'KeyboardAvoidingView', 'ScrollView', 'Modal', 'View'].map(name => [name, name])),
    },
    'expo-router': {
      Stack: { Screen: 'StackScreen' },
      useNavigation: () => ({ dispatch: action => navigation.push(['dispatch', action]) }),
      useRouter: () => Object.fromEntries(['back', 'replace', 'push', 'dismissAll'].map(name => [name, (...args) => navigation.push([name, ...args])])),
      useLocalSearchParams: () => ({ id: routeId }),
      useIsFocused: () => focused,
      useFocusEffect(fn) {
        const index = focusCursor++, previous = focusEffects[index];
        if (previous?.fn === fn && previous.focused === focused) return;
        const next = { fn, focused };
        focusEffects[index] = next;
        pendingFocus.push(() => { previous?.dispose?.(); if (next.focused) next.dispose = fn(); });
      },
    },
    'expo-router/react-navigation': {
      usePreventRemove(enabled, callback) { removalGuard = { enabled, callback }; },
    },
    'expo-image': { Image: 'Image' },
    '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/ui': Object.fromEntries(['Button', 'Card', 'Field', 'HeaderButton', 'LoadingView', 'Segmented', 'StateView', 'SwitchRow'].map(name => [name, name])),
    '@/constants/theme': { Radius: { control: 14, card: 20 }, Spacing: { half: 2, one: 4, two: 8, three: 16, four: 24 } },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-query': { useQuery: () => ({ data: null, loading: false, refreshing: false, refresh() {}, ...queryState }) },
    '@/lib/data': { data: api },
    '@/ctx/session': { useSession: () => ({ user }) },
    '@/lib/config': { isDemoMode: false },
    '@/lib/album-edit-release': { albumEditReleaseEnabled: editingAvailable, isAlbumEditingAvailable: () => editingAvailable },
    '@/lib/photo-retry-release': { photoRetryReleaseEnabled: false, isPhotoRetryAvailable: () => false },
    '@/lib/preset-release': { presetReleaseEnabled: false, isPresetPickingAvailable: () => false },
    '@/lib/photo-retry': { MAX_PHOTO_RETRIES_PER_TAP: 50, retryablePhotos: () => [], async retryPhotos() { throw Error('Closed retry gate must not send'); } },
    '@/lib/album-access-release': { albumAccessReleaseEnabled: false, isAlbumAccessEditingAvailable: () => false },
    '@/lib/supabase': { supabase: { auth: { onAuthStateChange(fn) {
      authListeners.add(fn);
      return { data: { subscription: { unsubscribe() { authListeners.delete(fn); } } } };
    } } } },
    '@/lib/data/album-list': { selectAlbums },
    '@/lib/i18n': { ...dictionary, useT: () => t },
    '@/lib/uploads/prefs': { getPreferredUploadSize: () => 'hd', setPreferredUploadSize() {}, getPreferredPreset: () => null, setPreferredPreset() {} },
    '@/components/preset-picker': { PresetPicker: 'PresetPicker' },
    '@/lib/uploads/queue': uploads,
  };
  const exports = load(relative, mocks, suffix);
  return {
    exports, t, navigation, alerts, authListeners,
    render(fn = exports.default, props) {
      stateCursor = refCursor = memoCursor = callbackCursor = effectCursor = layoutCursor = focusCursor = 0;
      const tree = fn(props);
      for (const pending of [pendingLayout, pendingEffects, pendingFocus]) {
        while (pending.length) pending.shift()();
      }
      return tree;
    },
    setFocused(next) { focused = next; },
    setContext(id, userId) { routeId = id; user = userId === null ? null : { id: userId }; },
    setQuery(next) { queryState = { ...queryState, ...next }; },
    removalGuard: () => removalGuard,
    remove(action) {
      if (removalGuard.enabled) removalGuard.callback({ data: { action } });
      else navigation.push(['dispatch', action]);
    },
    emitAuth(userId) {
      for (const listener of [...authListeners]) listener('AUTH_EVENT', userId === null ? null : { user: { id: userId } });
    },
    unmount() {
      for (const slots of [effects, layouts, focusEffects]) slots.forEach(entry => entry.dispose?.());
    },
  };
}
const newAlbumRoute = 'app/(app)/(albums)/new-album.tsx';
function fillNewAlbum(h) {
  const tree = h.render();
  find(tree, node => node.props?.label === h.t.newAlbum.nameLabel).props.onChangeText('  Wedding  ');
  find(tree, node => node.props?.label === h.t.newAlbum.descriptionLabel).props.onChangeText('  Details  ');
  return h.render();
}

test('creating an album is single-flight before render and opens the returned album ready for uploading', async () => {
  const request = deferred(), calls = [];
  const h = harness(newAlbumRoute, { api: { createAlbum: input => { calls.push(input); return request.promise; } } });
  const tree = fillNewAlbum(h);
  const create = find(tree, node => node.props?.label === h.t.newAlbum.create).props.onPress;
  const pending = create();
  await create();
  const oldCancel = find(tree, node => node.type === 'StackScreen').props.options.headerLeft();
  oldCancel.props.onPress();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, 'Wedding');
  assert.equal(calls[0].description, 'Details');
  assert.equal(h.navigation.length, 0);
  const busyTree = h.render();
  assert.equal(find(busyTree, node => node.type === 'Field').props.editable, false);
  request.resolve({ id: 'created-owned-album' });
  await pending;
  await create();
  assert.equal(calls.length, 1);
  assert.equal(h.navigation.length, 1);
  assert.equal(h.navigation[0][0], 'replace');
  assert.equal(h.navigation[0][1].params.id, 'created-owned-album');
});

test('invalid album names do not write, and failed creation unlocks an intentional retry', async () => {
  let count = 0;
  const h = harness(newAlbumRoute, { api: { async createAlbum() { count++; throw new types.DataError('network'); } } });
  await find(h.render(), node => node.props?.label === h.t.newAlbum.create).props.onPress();
  assert.equal(count, 0);
  const tree = fillNewAlbum(h);
  await find(tree, node => node.props?.label === h.t.newAlbum.create).props.onPress();
  assert.equal(count, 1);
  const retryTree = h.render();
  assert.equal(find(retryTree, node => node.type === 'Field').props.editable, true);
  assert.ok(find(retryTree, node => node.props?.children === h.t.common.errorNetwork));
  await find(retryTree, node => node.props?.label === h.t.newAlbum.create).props.onPress();
  assert.equal(count, 2);
});

const settingsRoute = 'app/(app)/(albums)/album/[id]/settings.tsx';
function settingsHarness(api, options = {}) {
  const h = harness(settingsRoute, { ...options, api, suffix: '\nexports.form = SettingsForm;' });
  h.props = { album: album('owned-album', 'Wedding'), accountId: 'owner', eligible: true };
  h.form = () => h.render(h.exports.form, h.props);
  return h;
}

test('metadata save whitelists name and description, rejects duplicate taps and retries only after failure', async () => {
  const calls = [];
  const request = deferred();
  const h = settingsHarness({
    updateAlbumDetails(input) { calls.push(input); return request.promise; },
    updateAlbumSettings() { throw new Error('Unexpected sharing/password mutation'); },
    deleteAlbum() { throw new Error('Unexpected album deletion'); },
  });
  let tree = h.form();
  find(tree, node => node.props?.label === h.t.newAlbum.nameLabel).props.onChangeText('  Wedding revised  ');
  find(tree, node => node.props?.label === h.t.newAlbum.descriptionLabel).props.onChangeText('  Details revised  ');
  tree = h.form();
  const save = find(tree, node => node.props?.label === h.t.common.save).props.onPress;
  const pending = save();
  await save();
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['albumId', 'description', 'title']);
  assert.equal(calls[0].albumId, 'owned-album');
  assert.equal(calls[0].title, 'Wedding revised');
  assert.equal(calls[0].description, 'Details revised');
  assert.equal(h.alerts.length, 0);
  const busy = h.form();
  assert.equal(find(busy, node => node.props?.label === h.t.newAlbum.nameLabel).props.editable, false);
  assert.equal(find(busy, node => node.props?.label === h.t.newAlbum.descriptionLabel).props.editable, false);
  request.reject(new types.DataError('network'));
  await pending;
  const failed = h.form();
  assert.ok(textContent(failed).includes(h.t.common.errorNetwork));
  await find(failed, node => node.props?.label === h.t.common.save).props.onPress();
  assert.equal(calls.length, 2);
  assert.equal(h.navigation.length, 0);
});

test('metadata-only settings never expose native deletion, password or download mutation controls', () => {
  const h = settingsHarness({
    updateAlbumDetails() { throw new Error('Unexpected mount mutation'); },
    updateAlbumSettings() { throw new Error('Unexpected full-settings mutation'); },
    deleteAlbum() { throw new Error('Unexpected deletion'); },
  });
  h.props.album = { ...h.props.album, isPasswordProtected: true, allowDownload: false,
    downloadSize: 'original', password: 'private-password-fixture' };
  const tree = h.form();
  assert.equal(find(tree, node => node.type === 'SwitchRow'), undefined);
  assert.equal(find(tree, node => node.type === 'Segmented'), undefined);
  assert.equal(find(tree, node => node.props?.secureTextEntry), undefined);
  assert.equal(find(tree, node => node.props?.label === h.t.settings.deleteAlbum), undefined);
  assert.equal(find(tree, node => node.props?.label === h.t.settings.passwordNew || node.props?.label === h.t.settings.passwordKeep), undefined);
  assert.ok(textContent(tree).includes(h.t.settings.metadataOnly));
  assert.ok(textContent(tree).includes(h.t.settings.sharingReadonly));
  assert.ok(!textContent(tree).includes('private-password-fixture'));
  assert.equal(h.alerts.length, 0);
  assert.equal(h.navigation.length, 0);
});

test('unreleased metadata editing displays truthful read-only details and cannot write even through its disabled callback', async () => {
  let calls = 0;
  const h = settingsHarness({ updateAlbumDetails() { calls++; } }, { editingAvailable: false });
  const tree = h.form();
  const name = find(tree, node => node.props?.label === h.t.newAlbum.nameLabel);
  const description = find(tree, node => node.props?.label === h.t.newAlbum.descriptionLabel);
  assert.equal(name.props.value, 'Wedding');
  assert.equal(name.props.editable, false);
  assert.equal(description.props.editable, false);
  assert.ok(textContent(tree).includes(h.t.settings.editPendingMessage));
  const save = find(tree, node => node.type === 'Button');
  assert.equal(save.props.disabled, true);
  await save.props.onPress();
  assert.equal(calls, 0);
  assert.equal(h.navigation.length, 0);
});

test('only an acknowledged current metadata save navigates once; success does not repeat a mutation', async () => {
  const request = deferred();
  let calls = 0;
  const h = settingsHarness({ updateAlbumDetails() { calls++; return request.promise; } });
  const tree = h.form();
  const save = find(tree, node => node.props?.label === h.t.common.save).props.onPress;
  const pending = save();
  await save();
  assert.equal(calls, 1);
  assert.equal(h.navigation.length, 0);
  request.resolve();
  await pending;
  await save();
  assert.equal(calls, 1);
  assert.deepEqual(h.navigation, [['back']]);
});

test('blank or oversized metadata never writes and reports localized validation', async () => {
  for (const [title, description, copy] of [
    ['  ', '', 'nameRequired'],
    ['x'.repeat(121), '', 'detailsTooLong'],
    ['Wedding', 'x'.repeat(501), 'detailsTooLong'],
  ]) {
    let calls = 0;
    const h = settingsHarness({ updateAlbumDetails() { calls++; } });
    let tree = h.form();
    find(tree, node => node.props?.label === h.t.newAlbum.nameLabel).props.onChangeText(title);
    find(tree, node => node.props?.label === h.t.newAlbum.descriptionLabel).props.onChangeText(description);
    tree = h.form();
    await find(tree, node => node.props?.label === h.t.common.save).props.onPress();
    assert.equal(calls, 0);
    assert.equal(h.navigation.length, 0);
    const expected = copy === 'nameRequired' ? h.t.newAlbum[copy] : h.t.settings[copy];
    assert.ok(textContent(h.form()).includes(expected));
  }
});

test('stale failed-query or refreshing eligibility blocks captured saves and cannot acknowledge a pending save', async () => {
  const request = deferred();
  let calls = 0;
  const h = settingsHarness({ updateAlbumDetails() { calls++; return request.promise; } });
  const save = find(h.form(), node => node.props?.label === h.t.common.save).props.onPress;
  const pending = save();
  h.props = { ...h.props, eligible: false };
  const refreshing = h.form();
  assert.equal(find(refreshing, node => node.type === 'Button').props.disabled, true);
  await save();
  assert.equal(calls, 1);
  request.resolve();
  await pending;
  assert.equal(h.navigation.length, 0);
});

test('blur and unmount prevent pending metadata acknowledgements or failures from navigating', async () => {
  for (const ending of ['blur', 'unmount']) {
    const request = deferred();
    let calls = 0;
    const h = settingsHarness({ updateAlbumDetails() { calls++; return request.promise; } });
    const save = find(h.form(), node => node.props?.label === h.t.common.save).props.onPress;
    const pending = save();
    if (ending === 'blur') { h.setFocused(false); h.form(); }
    else h.unmount();
    await save();
    request.resolve();
    await pending;
    assert.equal(calls, 1);
    assert.equal(h.navigation.length, 0);
    assert.equal(h.alerts.length, 0);
    if (ending === 'unmount') assert.equal(h.authListeners.size, 0);
  }
});

test('SDK identity change immediately fences old metadata callbacks before React replaces the route', async () => {
  for (const nextOwner of [null, 'other-owner']) {
    const request = deferred();
    let calls = 0;
    const h = settingsHarness({ updateAlbumDetails() { calls++; return request.promise; } });
    const save = find(h.form(), node => node.props?.label === h.t.common.save).props.onPress;
    const pending = save();
    h.emitAuth(nextOwner);
    await save();
    request.resolve();
    await pending;
    assert.equal(calls, 1);
    assert.equal(h.navigation.length, 0);
    const fenced = h.form();
    assert.equal(fenced.type, 'StateView');
    assert.equal(fenced.props.title, h.t.common.errorSession);
    h.unmount();
    assert.equal(h.authListeners.size, 0);
  }
});

test('same-account return and refocus do not revive an earlier save or expose its stale error', async () => {
  for (const transition of ['auth', 'focus']) {
    const request = deferred();
    let calls = 0;
    const h = settingsHarness({ updateAlbumDetails() { calls++; return request.promise; } });
    const save = find(h.form(), node => node.props?.label === h.t.common.save).props.onPress;
    const pending = save();
    if (transition === 'auth') { h.emitAuth(null); h.emitAuth('owner'); }
    else { h.setFocused(false); h.form(); h.setFocused(true); h.form(); }
    await save();
    request.reject(new types.DataError('network', 'private-stale-error-fixture'));
    await pending;
    assert.equal(calls, 1);
    assert.equal(h.navigation.length, 0);
    const text = textContent(h.form());
    assert.ok(!text.includes(h.t.common.errorNetwork));
    assert.ok(!text.includes('private-stale-error-fixture'));
  }
});

test('matching-owner token refresh keeps a current acknowledged metadata save valid', async () => {
  const request = deferred();
  const h = settingsHarness({ updateAlbumDetails() { return request.promise; } });
  const pending = find(h.form(), node => node.props?.label === h.t.common.save).props.onPress();
  h.emitAuth('owner');
  request.resolve();
  await pending;
  assert.deepEqual(h.navigation, [['back']]);
});

test('Thai/English metadata counters and draft copy describe local unsaved text without an automatic write', () => {
  for (const language of ['th', 'en']) {
    let writes = 0;
    const h = settingsHarness({ updateAlbumDetails() { writes++; } }, { language });
    let tree = h.form();
    assert.equal(h.removalGuard().enabled, false);
    assert.ok(textContent(tree).includes(h.t.settings.characterCount(7, 120)));
    assert.ok(textContent(tree).includes(h.t.settings.characterCount(0, 500)));
    assert.ok(textContent(tree).includes(h.t.settings.unchangedDetails));
    find(tree, node => node.props?.label === h.t.newAlbum.descriptionLabel).props.onChangeText('งานแต่ง');
    tree = h.form();
    assert.equal(h.removalGuard().enabled, true);
    assert.ok(textContent(tree).includes(h.t.settings.unsavedChanges));
    assert.ok(textContent(tree).includes(h.t.settings.draftHint));
    assert.ok(textContent(tree).includes(h.t.settings.characterCount('งานแต่ง'.length, 500)));
    assert.equal(writes, 0);
    assert.equal(h.alerts.length, 0);
    assert.equal(h.navigation.length, 0);
  }
});

function editSettings(h, title = 'Revised', description = '') {
  const tree = h.form();
  find(tree, node => node.props?.label === h.t.newAlbum.nameLabel).props.onChangeText(title);
  find(tree, node => node.props?.label === h.t.newAlbum.descriptionLabel).props.onChangeText(description);
  return h.form();
}
const backAction = () => ({ type: 'GO_BACK', source: 'fixture-route', marker: Symbol('original-action') });

test('unchanged/restored drafts leave normally; whitespace-only edits still require deliberate discard', () => {
  const h = settingsHarness({});
  h.form();
  const clean = backAction();
  h.remove(clean);
  assert.equal(h.navigation[0][1], clean);
  editSettings(h, 'Wedding ');
  h.remove(backAction());
  assert.equal(h.alerts.length, 1);
  h.alerts[0][2][0].onPress();
  editSettings(h, 'Wedding');
  assert.equal(h.removalGuard().enabled, false);
  assert.ok(textContent(h.form()).includes(h.t.settings.unchangedDetails));
});

test('keep-editing and Android alert dismissal retain the draft and never save or navigate', () => {
  let writes = 0;
  const h = settingsHarness({ updateAlbumDetails() { writes++; } });
  editSettings(h);
  h.remove(backAction());
  const first = h.alerts[0];
  assert.equal(first[0], h.t.settings.discardTitle);
  assert.equal(first[1], h.t.settings.discardMessage);
  assert.equal(first[2].length, 2);
  assert.equal(first[2][0].style, 'cancel');
  first[2][0].onPress();
  first[2][1].onPress(); // A queued discarded button from the cancelled dialog.
  assert.equal(h.navigation.length, 0);
  h.remove(backAction());
  h.alerts[1][3].onDismiss();
  h.alerts[1][2][1].onPress();
  assert.equal(h.navigation.length, 0);
  assert.equal(writes, 0);
  assert.equal(find(h.form(), node => node.props?.label === h.t.newAlbum.nameLabel).props.value, 'Revised');
});

test('discard repeats the exact original removal once and fences old save/input callbacks without deleting an album', async () => {
  let writes = 0;
  const h = settingsHarness({
    updateAlbumDetails() { writes++; },
    deleteAlbum() { throw Error('Unexpected album deletion'); },
    updateAlbumSettings() { throw Error('Unexpected full-settings write'); },
  });
  const edited = editSettings(h);
  const oldSave = find(edited, node => node.type === 'Button').props.onPress;
  const oldInput = find(edited, node => node.type === 'Field').props.onChangeText;
  const action = backAction();
  h.remove(action);
  const discard = h.alerts[0][2][1].onPress;
  discard();
  discard();
  await oldSave();
  oldInput('Must not revive');
  assert.equal(writes, 0);
  assert.equal(h.navigation.length, 1);
  assert.equal(h.navigation[0][1], action);
  assert.equal(find(h.form(), node => node.type === 'Field').props.value, 'Wedding');
  assert.equal(h.removalGuard().enabled, false);
});

test('repeated back attempts show one dialog and confirm only its original action', () => {
  const h = settingsHarness({});
  editSettings(h);
  const first = backAction();
  h.remove(first);
  h.remove(backAction());
  h.remove(backAction());
  assert.equal(h.alerts.length, 1);
  h.alerts[0][2][1].onPress();
  assert.equal(h.navigation.length, 1);
  assert.equal(h.navigation[0][1], first);
});

test('an edit after opening a dialog invalidates its discard, even for a batched away-and-back edit', () => {
  const h = settingsHarness({});
  let tree = editSettings(h);
  h.remove(backAction());
  const oldDiscard = h.alerts[0][2][1].onPress;
  const input = find(tree, node => node.type === 'Field').props.onChangeText;
  input('Different');
  input('Revised');
  oldDiscard();
  assert.equal(h.navigation.length, 0);
  tree = h.form();
  assert.equal(find(tree, node => node.type === 'Field').props.value, 'Revised');
  h.remove(backAction());
  assert.equal(h.alerts.length, 2);
});

test('SDK owner loss/change and same-account return cannot revive old discard confirmations', () => {
  for (const owners of [[null], ['other-owner'], [null, 'owner']]) {
    const h = settingsHarness({});
    editSettings(h);
    h.remove(backAction());
    const oldDiscard = h.alerts[0][2][1].onPress;
    owners.forEach(owner => h.emitAuth(owner));
    oldDiscard();
    assert.equal(h.navigation.length, 0);
  }
});

test('same-owner token refresh preserves a deliberate current discard confirmation', () => {
  const h = settingsHarness({});
  editSettings(h);
  const action = backAction();
  h.remove(action);
  h.emitAuth('owner');
  h.alerts[0][2][1].onPress();
  assert.equal(h.navigation[0][1], action);
});

test('blur/refocus and unmount invalidate old discard tickets and unmounted input callbacks', () => {
  for (const transition of ['focus', 'unmount']) {
    const h = settingsHarness({});
    const tree = editSettings(h);
    h.remove(backAction());
    const oldDiscard = h.alerts[0][2][1].onPress;
    const oldInput = find(tree, node => node.type === 'Field').props.onChangeText;
    if (transition === 'focus') {
      h.setFocused(false); h.form();
      h.setFocused(true); h.form();
    } else {
      h.unmount();
      oldInput('Stale');
    }
    oldDiscard();
    assert.equal(h.navigation.length, 0);
    if (transition === 'unmount') assert.equal(h.authListeners.size, 0);
  }
});

test('back while saving shows inline waiting feedback, never a lingering native alert; a failed save retains the draft for deliberate retry', async () => {
  const request = deferred();
  let writes = 0;
  const h = settingsHarness({ updateAlbumDetails() { writes++; return request.promise; } });
  const tree = editSettings(h);
  const oldInput = find(tree, node => node.type === 'Field').props.onChangeText;
  const pending = find(tree, node => node.type === 'Button' && node.props.label === h.t.common.save).props.onPress();
  h.form();
  h.remove(backAction());
  h.remove(backAction());
  assert.equal(h.alerts.length, 0);
  assert.ok(textContent(h.form()).includes(h.t.settings.saveInProgress));
  assert.ok(textContent(h.form()).includes(h.t.settings.saveWait));
  oldInput('Cannot edit an in-flight save');
  assert.equal(h.navigation.length, 0);
  request.reject(new types.DataError('network'));
  await pending;
  const failed = h.form();
  assert.equal(find(failed, node => node.type === 'Field').props.value, 'Revised');
  assert.ok(textContent(failed).includes(h.t.settings.unsavedChanges));
  assert.ok(textContent(failed).includes(h.t.common.errorNetwork));
  assert.ok(!textContent(failed).includes(h.t.settings.saveWait));
  assert.equal(writes, 1);
  h.remove(backAction());
  assert.equal(h.alerts.length, 1);
  assert.equal(h.alerts[0][0], h.t.settings.discardTitle);
});

test('starting a save invalidates a prior discard without cancelling/repeating the original write', async () => {
  const request = deferred();
  let writes = 0;
  const h = settingsHarness({ updateAlbumDetails() { writes++; return request.promise; } });
  const tree = editSettings(h);
  h.remove(backAction());
  const oldDiscard = h.alerts[0][2][1].onPress;
  const pending = find(tree, node => node.type === 'Button' && node.props.label === h.t.common.save).props.onPress();
  oldDiscard();
  assert.equal(h.navigation.length, 0);
  assert.equal(writes, 1);
  request.resolve();
  await pending;
  assert.deepEqual(h.navigation, [['back']]);
});

test('an acknowledged save bypasses the old enabled removal hook and does not offer a discard or repeat the write', async () => {
  const request = deferred();
  let writes = 0;
  const h = settingsHarness({ updateAlbumDetails() { writes++; return request.promise; } });
  const tree = editSettings(h);
  const oldGuard = h.removalGuard().callback;
  const pending = find(tree, node => node.type === 'Button' && node.props.label === h.t.common.save).props.onPress();
  request.resolve();
  await pending;
  const action = backAction();
  oldGuard({ data: { action } });
  oldGuard({ data: { action: backAction() } });
  assert.equal(h.alerts.length, 0);
  assert.deepEqual(h.navigation[0], ['back']);
  assert.equal(h.navigation[1][1], action);
  assert.equal(h.navigation.length, 2);
  assert.equal(writes, 1);
});

test('a save callback captured before a newer edit cannot send the older title before React commits', async () => {
  let writes = 0;
  const h = settingsHarness({ updateAlbumDetails() { writes++; } });
  const tree = editSettings(h);
  const oldSave = find(tree, node => node.type === 'Button' && node.props.label === h.t.common.save).props.onPress;
  find(tree, node => node.type === 'Field').props.onChangeText('Newest');
  await oldSave();
  assert.equal(writes, 0);
  const current = h.form();
  await find(current, node => node.type === 'Button' && node.props.label === h.t.common.save).props.onPress();
  assert.equal(writes, 1);
});

test('cached query refreshes do not overwrite a draft or its initial baseline; failed reads still prevent saving', async () => {
  let writes = 0;
  const h = settingsHarness({ updateAlbumDetails() { writes++; } });
  editSettings(h);
  h.props = { ...h.props, album: { ...h.props.album, title: 'Server refreshed' }, eligible: false };
  const tree = h.form();
  assert.equal(find(tree, node => node.type === 'Field').props.value, 'Revised');
  assert.ok(textContent(tree).includes(h.t.settings.unsavedChanges));
  await find(tree, node => node.type === 'Button').props.onPress();
  assert.equal(writes, 0);
  h.remove(backAction());
  assert.equal(h.alerts[0][0], h.t.settings.discardTitle);
});

test('disabled/unreleased and unauthorized draft callbacks never modify fields or create unsaved work', () => {
  for (const disabled of ['gate', 'refresh', 'auth']) {
    const h = settingsHarness({}, { editingAvailable: disabled !== 'gate' });
    if (disabled === 'refresh') h.props.eligible = false;
    const tree = h.form();
    if (disabled === 'auth') h.emitAuth(null);
    find(tree, node => node.type === 'Field').props.onChangeText('Blocked');
    const current = h.form();
    if (disabled !== 'auth') {
      assert.equal(find(current, node => node.type === 'Field').props.value, 'Wedding');
      assert.equal(h.removalGuard().enabled, false);
    } else {
      assert.equal(current.type, 'StateView');
    }
    assert.equal(h.navigation.length, 0);
    assert.equal(h.alerts.length, 0);
  }
});

test('settings loaders isolate account/album keys and never turn mismatched or failed cached data into writable fields', () => {
  const owned = album('owned-album', 'Wedding');
  const h = harness(settingsRoute, { query: { data: owned }, suffix: '\nexports.loader = AlbumSettingsLoader;' });
  const first = h.render();
  assert.equal(first.props.albumId, 'owned-album');
  assert.equal(first.props.accountId, 'owner');
  h.setContext('owned-album', 'other-owner');
  const otherAccount = h.render();
  assert.notEqual(otherAccount.key, first.key);
  h.setContext('other-album', 'other-owner');
  assert.notEqual(h.render().key, otherAccount.key);
  h.setContext('owned-album', 'owner');
  h.setQuery({ data: album('foreign-album', 'Foreign') });
  const wrong = h.render(h.exports.loader, first.props);
  assert.equal(wrong.type, 'StateView');
  assert.equal(wrong.props.title, h.t.common.errorNotFound);
  h.setQuery({ data: owned, error: new types.DataError('network', 'private-query-error-fixture') });
  const failed = h.render(h.exports.loader, first.props);
  const form = find(failed, node => typeof node.type === 'function' && node.type.name === 'SettingsForm');
  assert.ok(form);
  assert.equal(form.props.eligible, false);
  assert.equal(find(failed, node => node.type === 'StateView').props.title, h.t.common.errorNetwork);
  assert.ok(!textContent(failed).includes('private-query-error-fixture'));
  h.setQuery({ error: null, refreshing: true });
  assert.equal(find(h.render(h.exports.loader, first.props), node => typeof node.type === 'function').props.eligible, false);
  h.setContext('owned-album', null);
  assert.equal(h.render().props.title, h.t.common.errorSession);
});

test('album tools retain cached rows on failed refresh and distinguish no search results from no albums', () => {
  const rows = [album('owned-album', 'Wedding')];
  const h = harness('app/(app)/(albums)/index.tsx', { query: { data: rows, error: new types.DataError('network') } });
  let list = find(h.render(), node => node.type === 'FlatList');
  assert.equal(list.props.data.length, 1);
  const search = find(list.props.ListHeaderComponent, node => node.type === 'TextInput');
  search.props.onChangeText('something else');
  list = find(h.render(), node => node.type === 'FlatList');
  assert.equal(list.props.data.length, 0);
  assert.equal(list.props.ListEmptyComponent.props.title, h.t.albums.noResults);
  assert.ok(find(list.props.ListHeaderComponent, node => node.props?.title === h.t.common.errorNetwork));
  list.props.ListEmptyComponent.props.onAction();
  list = find(h.render(), node => node.type === 'FlatList');
  assert.equal(list.props.data.length, 1);
  list.props.renderItem({ item: rows[0] });
});

test('upload preparation locks synchronously, cannot be cancelled mid-copy and reports the foreground requirement', async () => {
  const request = deferred();
  let calls = 0, closed = 0;
  const h = harness('components/upload-sheet.tsx', { uploads: { enqueueUploads() { calls++; return request.promise; } } });
  const props = { album: album('owned-album', 'Wedding'), assets: [{}], onClose() { closed++; } };
  const tree = h.render(h.exports.UploadSheet, props);
  assert.ok(find(tree, node => node.props?.children === h.t.uploads.foregroundHint));
  const start = find(tree, node => node.props?.label === h.t.uploads.start).props.onPress;
  const cancel = find(tree, node => node.props?.label === h.t.common.cancel).props.onPress;
  const pending = start();
  await start(); cancel();
  assert.equal(calls, 1);
  assert.equal(closed, 0);
  request.resolve({ unreadable: 0, alreadyQueued: 0 });
  await pending;
  await start();
  assert.equal(closed, 1);
  assert.equal(calls, 1);
});

test('failed upload preparation releases the gate for an explicit retry', async () => {
  let calls = 0;
  const h = harness('components/upload-sheet.tsx', { uploads: { async enqueueUploads() { calls++; throw new Error('offline'); } } });
  const props = { album: album('owned-album', 'Wedding'), assets: [{}], onClose() {} };
  let tree = h.render(h.exports.UploadSheet, props);
  await find(tree, node => node.props?.label === h.t.uploads.start).props.onPress();
  tree = h.render(h.exports.UploadSheet, props);
  await find(tree, node => node.props?.label === h.t.uploads.start).props.onPress();
  assert.equal(calls, 2);
});
