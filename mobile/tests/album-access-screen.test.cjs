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

function find(tree, match) {
  if (!tree || typeof tree !== 'object') return;
  if (match(tree)) return tree;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const result = find(child, match);
    if (result) return result;
  }
}

function content(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  const children = tree.props?.children;
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(content).join('\n');
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

// Native dialogs, transport and session events are mocked. The actual screen
// and lifetime guard run with keyed React hook scopes and effects.
// This is an offline callback/state regression, not device-layout acceptance.
function harness({ locale = 'th', gate = true, demo = false, read, update } = {}) {
  const t = dictionary.getDictionary(locale), scopes = new Map(), commits = [];
  const alerts = [], reads = [], writes = [], navigation = [], authListeners = new Set();
  let user = { id: 'owner-a' }, routeId = 'owned-album', focused = true, scope;
  let removalGuard = { enabled: false, callback: null };
  const same = (a, b) => a !== undefined && b !== undefined && a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  function memo(kind, factory, deps) {
    const index = scope.cursors[kind]++;
    if (!scope[kind][index] || !same(scope[kind][index].deps, deps)) {
      scope[kind][index] = { deps, value: factory() };
    }
    return scope[kind][index].value;
  }
  function effect(kind, callback, deps) {
    const local = scope, index = local.cursors[kind]++, previous = local[kind][index];
    if (previous && same(previous.deps, deps)) return;
    const next = { deps }; local[kind][index] = next;
    commits.push(() => { previous?.dispose?.(); if (local.alive) next.dispose = callback(); });
  }
  const react = {
    useState(initial) {
      const local = scope, index = local.cursors.states++;
      if (!(index in local.states)) local.states[index] = typeof initial === 'function' ? initial() : initial;
      return [local.states[index], next => {
        local.states[index] = typeof next === 'function' ? next(local.states[index]) : next;
      }];
    },
    useRef(initial) { const index = scope.cursors.refs++; return scope.refs[index] ??= { current: initial }; },
    useMemo: (fn, deps) => memo('memos', fn, deps),
    useCallback: (fn, deps) => memo('callbacks', () => fn, deps),
    useEffect: (fn, deps) => effect('effects', fn, deps),
    useLayoutEffect: (fn, deps) => effect('layout', fn, deps),
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const mocks = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, react,
    'react-native': {
      StyleSheet: { create: value => value }, Platform: { OS: 'ios' },
      Alert: { alert: (...args) => alerts.push(args) },
      ...Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'ScrollView', 'Switch', 'View'].map(name => [name, name])),
    },
    'expo-router': {
      useLocalSearchParams: () => ({ id: routeId }), useIsFocused: () => focused,
      useRouter: () => Object.fromEntries(['back', 'push', 'replace'].map(name => [name, (...args) => navigation.push([name, ...args])])),
      useNavigation: () => ({ dispatch: action => navigation.push(['dispatch', action]) }),
      useFocusEffect(callback) {
        const local = scope, index = local.cursors.focus++, previous = local.focus[index];
        if (previous && previous.callback === callback && previous.focused === focused) return;
        const next = { callback, focused }; local.focus[index] = next;
        commits.push(() => { previous?.dispose?.(); if (local.alive && next.focused) next.dispose = callback(); });
      },
    },
    'expo-router/react-navigation': {
      usePreventRemove(enabled, callback) { removalGuard = { enabled, callback }; },
    },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ui': Object.fromEntries(['Button', 'Card', 'Field', 'HeaderButton', 'LoadingView', 'Segmented', 'StateView', 'SwitchRow'].map(name => [name, name])),
    '@/constants/theme': { Radius: { control: 14, card: 20, pill: 999 }, Spacing: { half: 2, one: 4, two: 8, three: 16, four: 24, six: 32 } },
    '@/ctx/session': { useSession: () => ({ user }) },
    '@/hooks/use-theme': { useTheme: () => ({ danger: '#c00' }) },
    '@/lib/album-access-release': { isAlbumAccessEditingAvailable: () => gate, albumAccessReleaseEnabled: gate },
    '@/lib/config': { isDemoMode: demo },
    '@/lib/data/types': types,
    '@/lib/data': { ...types, data: {
      async fetchAlbumAccess(id) { reads.push(id); return read ? read(id, reads.length) : snapshot(); },
      async updateAlbumAccess(input) { writes.push(input); return update ? update(input) : snapshot(input); },
      updateAlbumDetails() { throw new Error('Unexpected metadata mutation'); },
      updateAlbumSettings() { throw new Error('Unexpected legacy settings mutation'); },
      deleteAlbum() { throw new Error('Unexpected album deletion'); },
    } },
    '@/lib/i18n': { ...dictionary, useT: () => t },
    '@/lib/supabase': { supabase: { auth: { onAuthStateChange(callback) {
      authListeners.add(callback);
      return { data: { subscription: { unsubscribe() { authListeners.delete(callback); } } } };
    } } } },
  };
  mocks['@/hooks/use-album-cover-guard'] = load('hooks/use-album-cover-guard.ts', mocks);
  mocks['@/lib/album-access-draft'] = load('lib/album-access-draft.ts', { '@/lib/data/types': types });
  const Screen = load('app/(app)/(albums)/album/[id]/access.tsx', mocks).default;
  function clean(local) {
    if (!local?.alive) return; local.alive = false;
    for (const kind of ['layout', 'effects', 'focus']) local[kind].forEach(entry => entry?.dispose?.());
  }
  function renderComponent(fn, props, key, active) {
    active.add(key); scope = scopes.get(key);
    if (!scope) {
      scope = { states: [], refs: [], memos: [], callbacks: [], layout: [], effects: [], focus: [], alive: true };
      scopes.set(key, scope);
    }
    scope.cursors = Object.fromEntries(['states', 'refs', 'memos', 'callbacks', 'layout', 'effects', 'focus'].map(name => [name, 0]));
    return renderTree(fn(props), key, active);
  }
  function renderTree(tree, parentKey, active) {
    if (!tree || typeof tree !== 'object') return tree;
    if (Array.isArray(tree)) return tree.map((child, i) => renderTree(child, `${parentKey}:${i}`, active));
    if (typeof tree.type === 'function') {
      return renderComponent(tree.type, tree.props, `${parentKey}/${tree.type.name}:${tree.key ?? ''}`, active);
    }
    const children = tree.props?.children;
    return { ...tree, props: { ...tree.props, children: renderTree(children, `${parentKey}/children`, active) } };
  }
  return {
    t, alerts, reads, writes, navigation,
    render() {
      const active = new Set(); const tree = renderComponent(Screen, undefined, 'root', active);
      for (const [key, local] of scopes) if (!active.has(key)) { clean(local); scopes.delete(key); }
      while (commits.length) commits.shift()();
      return tree;
    },
    async mount() { let tree; for (let i = 0; i < 4; i++) { tree = this.render(); await settle(); } return tree; },
    wrapper() { return Screen(); },
    setFocused(value) { focused = value; },
    setContext(id, accountId) { routeId = id; user = accountId === null ? null : { id: accountId }; },
    emitAuth(accountId) { for (const callback of [...authListeners]) callback('AUTH_EVENT', accountId === null ? null : { user: { id: accountId } }); },
    setGate(value) { gate = value; },
    remove(action) { if (removalGuard.enabled) removalGuard.callback({ data: { action } }); else navigation.push(['dispatch', action]); },
    removalGuard: () => removalGuard,
    unmount() { scopes.forEach(clean); scopes.clear(); },
  };
}

function snapshot(overrides = {}) {
  return { albumId: 'owned-album', allowDownload: true, downloadSize: 'hd', isPasswordProtected: false,
    revision: 'fixture-access-revision-1', ...overrides };
}

function button(tree, label) {
  const found = find(tree, node => node.type === 'Button' && node.props.label === label);
  assert.ok(found, `Missing button ${label}`); return found;
}

function switchFor(tree, label) {
  const found = find(tree, node => ['SwitchRow', 'Switch'].includes(node.type) &&
    (node.props.label === label || node.props.accessibilityLabel === label));
  assert.ok(found, `Missing switch ${label}`); return found;
}

function passwordField(tree) {
  const found = find(tree, node => node.type === 'Field' && node.props.secureTextEntry);
  assert.ok(found, 'Missing secure password field'); return found;
}

function dirtyDownloads(h) {
  const tree = h.render();
  switchFor(tree, h.t.access.allowDownload).props.onValueChange(false);
  return h.render();
}

async function review(h, tree = h.render()) {
  const save = button(tree, h.t.access.save).props.onPress;
  await save(); await settle();
  const dialog = h.alerts.findLast(args => args[0] === h.t.access.reviewTitle);
  assert.ok(dialog, 'Missing explicit access review dialog');
  return dialog;
}

function confirm(dialog) {
  const chosen = dialog[2].find(item => item.style !== 'cancel');
  assert.ok(chosen?.onPress, 'Missing review confirmation');
  return chosen.onPress();
}

test('closed live access gate mounts a truthful pending state with no access read or write', async () => {
  for (const locale of ['th', 'en']) {
    const h = harness({ locale, gate: false }); const tree = await h.mount();
    assert.deepEqual(h.reads, []); assert.deepEqual(h.writes, []);
    assert.equal(find(tree, node => node.type === 'StateView').props.title, h.t.access.pending);
    assert.equal(find(tree, node => node.type === 'Field'), undefined);
    assert.equal(find(tree, node => node.type === 'Switch' || node.type === 'SwitchRow'), undefined);
    assert.deepEqual(h.alerts, []);
  }
});

test('access loader is account/album keyed and missing session never calls access APIs', async () => {
  const h = harness(); const first = h.wrapper();
  assert.equal(first.props.accountId, 'owner-a');
  await h.mount(); assert.equal(h.reads[0], 'owned-album');
  h.setContext('another-album', 'owner-b'); const next = h.wrapper();
  assert.notEqual(first.key, next.key); assert.equal(next.props.accountId, 'owner-b');
  h.setContext('another-album', null); const count = h.reads.length;
  const tree = await h.mount();
  assert.equal(find(tree, node => node.type === 'StateView').props.title, h.t.common.errorSession);
  assert.equal(h.reads.length, count); assert.deepEqual(h.writes, []);
});

test('access form edits only governed download/password fields and renders all four delivery sizes', async () => {
  const h = harness(); const tree = await h.mount();
  for (const size of ['sd', 'hd', 'uhd', 'original']) button(tree, h.t.settings.sizes[size]);
  switchFor(tree, h.t.access.allowDownload); switchFor(tree, h.t.access.passwordProtection);
  assert.equal(find(tree, node => node.type === 'Field' && [h.t.newAlbum.nameLabel, h.t.newAlbum.descriptionLabel].includes(node.props.label)), undefined);
  assert.equal(button(tree, h.t.access.save).props.disabled, true);
  assert.deepEqual(h.writes, []);
});

test('password is secure local input and is never printed in text or confirmation messages', async () => {
  const h = harness(); let tree = await h.mount();
  switchFor(tree, h.t.access.passwordProtection).props.onValueChange(true); tree = h.render();
  const input = passwordField(tree); input.props.onChangeText('private-fixture-password');
  tree = h.render(); assert.equal(passwordField(tree).props.secureTextEntry, true);
  assert.equal(content(tree).includes('private-fixture-password'), false);
  await review(h, tree);
  assert.equal(JSON.stringify(h.alerts).includes('private-fixture-password'), false);
  assert.deepEqual(h.writes, []);
});

test('enabling password protection requires a password and rejects over 72 UTF-8 bytes', async () => {
  const h = harness(); let tree = await h.mount();
  switchFor(tree, h.t.access.passwordProtection).props.onValueChange(true); tree = h.render();
  await button(tree, h.t.access.save).props.onPress();
  assert.ok(content(h.render()).includes(h.t.access.passwordRequired));
  passwordField(h.render()).props.onChangeText('ก'.repeat(25));
  tree = h.render(); await button(tree, h.t.access.save).props.onPress();
  assert.ok(content(h.render()).includes(h.t.access.passwordTooLong));
  assert.equal(h.alerts.length, 0); assert.deepEqual(h.writes, []);
  passwordField(h.render()).props.onChangeText('ก'.repeat(24));
  await review(h, h.render()); assert.equal(h.writes.length, 0);
});

test('existing password can be preserved without retrieving or presenting a plaintext password', async () => {
  const h = harness({ read: () => snapshot({ isPasswordProtected: true }) }); await h.mount();
  const tree = dirtyDownloads(h); assert.equal(passwordField(tree).props.value, '');
  const dialog = await review(h, tree); await confirm(dialog); await settle();
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].password, '');
  assert.equal(h.writes[0].isPasswordProtected, true);
});

test('review cancellation and Android-style dismissal preserve draft and send no write', async () => {
  const h = harness(); await h.mount(); const tree = dirtyDownloads(h);
  const dialog = await review(h, tree);
  dialog[2].find(item => item.style === 'cancel').onPress();
  await settle();
  assert.equal(switchFor(h.render(), h.t.access.allowDownload).props.value, false);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.navigation, []);
  const next = await review(h); next[3].onDismiss(); await settle();
  assert.deepEqual(h.writes, []); assert.deepEqual(h.navigation, []);
});

test('rapid saves and repeated confirmation are single-flight before React commits', async () => {
  const fresh = deferred(), write = deferred();
  let delayed = false;
  const h = harness({ read: () => delayed ? fresh.promise : snapshot(), update: () => write.promise });
  await h.mount(); const tree = dirtyDownloads(h); const before = h.reads.length; delayed = true;
  const save = button(tree, h.t.access.save).props.onPress;
  const first = save(); const second = save(); await settle();
  assert.equal(h.reads.length, before + 1); assert.equal(h.alerts.length, 0); assert.deepEqual(h.writes, []);
  fresh.resolve(snapshot()); await first; await second; await settle();
  assert.equal(h.alerts.length, 1);
  const pending = confirm(h.alerts[0]); confirm(h.alerts[0]);
  assert.equal(h.writes.length, 1); assert.equal(h.navigation.length, 0);
  assert.deepEqual(Object.keys(h.writes[0]).sort(), ['albumId', 'allowDownload', 'downloadSize', 'isPasswordProtected', 'password', 'revision']);
  write.resolve(); await pending; await settle();
  assert.deepEqual(h.navigation, [['back']]);
  await save(); assert.equal(h.writes.length, 1);
});

test('fresh revision changes reset draft/password and require another deliberate save instead of overwrite', async () => {
  let changed = false;
  const h = harness({ read: () => snapshot(changed ? { downloadSize: 'uhd', revision: 'fixture-access-revision-2' } : {}) });
  let tree = await h.mount(); switchFor(tree, h.t.access.passwordProtection).props.onValueChange(true);
  tree = h.render(); passwordField(tree).props.onChangeText('unsent-private-password');
  tree = h.render(); changed = true;
  await button(tree, h.t.access.save).props.onPress(); await settle(); tree = h.render();
  assert.deepEqual(h.writes, []); assert.equal(h.alerts.length, 0);
  assert.ok(content(tree).includes(h.t.access.changed));
  assert.equal(switchFor(tree, h.t.access.passwordProtection).props.value, false);
  if (find(tree, node => node.type === 'Field' && node.props.secureTextEntry)) assert.equal(passwordField(tree).props.value, '');
  assert.equal(button(tree, h.t.settings.sizes.uhd).props.variant, 'primary');
  await button(tree, h.t.access.save).props.onPress(); assert.equal(h.writes.length, 0);
});

test('retained save, draft and confirmation callbacks cannot act after owner change, blur-return, or unmount', async () => {
  for (const expire of [
    async h => { h.emitAuth('other-owner'); h.emitAuth('owner-a'); await h.mount(); },
    async h => { h.setFocused(false); h.render(); h.setFocused(true); await h.mount(); },
    async h => { h.setContext('other-album', 'owner-b'); await h.mount(); },
    async h => { h.unmount(); },
  ]) {
    const h = harness(); await h.mount(); const tree = dirtyDownloads(h);
    const oldSave = button(tree, h.t.access.save).props.onPress;
    const oldEdit = switchFor(tree, h.t.access.allowDownload).props.onValueChange;
    const dialog = await review(h, tree); const reads = h.reads.length;
    await expire(h); const afterExpiryReads = h.reads.length;
    oldEdit(true); await oldSave(); await confirm(dialog); await settle();
    assert.deepEqual(h.writes, []); assert.deepEqual(h.navigation, []);
    assert.equal(h.reads.length, afterExpiryReads); assert.ok(afterExpiryReads >= reads);
  }
});

test('a read finishing after lifetime change cannot open an old review dialog', async () => {
  const pending = deferred(); let delayed = false;
  const h = harness({ read: () => delayed ? pending.promise : snapshot() });
  await h.mount(); const tree = dirtyDownloads(h); delayed = true;
  const save = button(tree, h.t.access.save).props.onPress; const work = save();
  h.emitAuth('other-owner'); h.emitAuth('owner-a'); pending.resolve(snapshot());
  await work; await settle(); assert.equal(h.alerts.length, 0); assert.deepEqual(h.writes, []);
});

test('wrong-album fresh reads cannot produce a write or successful navigation', async () => {
  let foreign = false;
  const h = harness({ read: () => snapshot(foreign ? { albumId: 'foreign-album' } : {}) });
  await h.mount(); const tree = dirtyDownloads(h); foreign = true;
  await button(tree, h.t.access.save).props.onPress(); await settle();
  assert.deepEqual(h.writes, []); assert.equal(h.alerts.length, 0); assert.deepEqual(h.navigation, []);
  assert.ok(content(h.render()).includes(h.t.common.errorGeneric));
});

test('closing access release gate invalidates a pending review without sending a write', async () => {
  const h = harness(); await h.mount(); const dialog = await review(h, dirtyDownloads(h));
  h.setGate(false); const tree = h.render(); await confirm(dialog); await settle();
  assert.equal(find(tree, node => node.type === 'StateView').props.title, h.t.access.pending);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.navigation, []);
});

test('password draft clears on blur and SDK identity change even when the same owner returns', async () => {
  for (const expire of [
    h => { h.setFocused(false); h.render(); h.setFocused(true); },
    h => { h.emitAuth('other-owner'); h.emitAuth('owner-a'); },
  ]) {
    const h = harness({ read: () => snapshot({ isPasswordProtected: true }) }); let tree = await h.mount();
    passwordField(tree).props.onChangeText('memory-only-fixture'); tree = h.render();
    assert.equal(passwordField(tree).props.value, 'memory-only-fixture');
    expire(h); tree = await h.mount(); assert.equal(passwordField(tree).props.value, '');
    assert.deepEqual(h.writes, []);
  }
});

test('read failure is generic, produces no confirmation, and does not automatically retry', async () => {
  let fail = false;
  const h = harness({ read: () => { if (fail) throw new types.DataError('network', 'private-read-fixture'); return snapshot(); } });
  await h.mount(); const tree = dirtyDownloads(h); fail = true; const before = h.reads.length;
  await button(tree, h.t.access.save).props.onPress(); await settle(); h.render(); await settle();
  assert.equal(h.reads.length, before + 1); assert.deepEqual(h.writes, []); assert.equal(h.alerts.length, 0);
  assert.equal(content(h.render()).includes('private-read-fixture'), false);
  assert.ok(content(h.render()).includes(h.t.common.errorNetwork));
  assert.deepEqual(h.navigation, []);
});

test('callbacks retained before an ambiguous failure cannot bypass mandatory explicit reload', async () => {
  for (const staleAction of ['save', 'edit']) {
    let fail = false;
    const h = harness({ read: () => { if (fail) throw new types.DataError('network'); return snapshot(); } });
    await h.mount(); const tree = dirtyDownloads(h); fail = true;
    const oldSave = button(tree, h.t.access.save).props.onPress;
    const oldEdit = switchFor(tree, h.t.access.allowDownload).props.onValueChange;
    await oldSave(); await settle(); h.render();
    const reads = h.reads.length;
    if (staleAction === 'save') await oldSave(); else oldEdit(true);
    await settle();
    assert.equal(h.reads.length, reads); assert.equal(h.writes.length, 0);
    assert.equal(switchFor(h.render(), h.t.access.allowDownload).props.value, false);
    assert.equal(button(h.render(), h.t.access.reload).props.disabled, false);
  }
});

test('write failure cannot navigate as success or retry automatically and does not leak raw errors', async () => {
  const h = harness({ update: async () => { throw new types.DataError('server', 'private-write-fixture'); } });
  await h.mount(); const dialog = await review(h, dirtyDownloads(h));
  await confirm(dialog); await settle(); const tree = h.render(); await settle();
  assert.equal(h.writes.length, 1); assert.deepEqual(h.navigation, []);
  assert.equal(content(tree).includes('private-write-fixture'), false);
  assert.ok(content(tree).includes(dictionary.describeError(h.t, new types.DataError('server'))));
  assert.equal(h.writes.length, 1);
});

test('acknowledged write uses reviewed revision and navigates back only after completion', async () => {
  const pending = deferred(); const h = harness({ update: () => pending.promise }); await h.mount();
  const dialog = await review(h, dirtyDownloads(h)); const work = confirm(dialog);
  assert.equal(h.writes[0].revision, 'fixture-access-revision-1');
  assert.equal(h.writes[0].allowDownload, false); assert.equal(h.writes[0].downloadSize, 'hd');
  assert.deepEqual(h.navigation, []); pending.resolve(); await work; await settle();
  assert.deepEqual(h.navigation, [['back']]);
});

test('an acknowledged write after identity or focus loss does not claim success on another visit', async () => {
  for (const expire of [
    h => { h.emitAuth('other-owner'); h.emitAuth('owner-a'); },
    h => { h.setFocused(false); h.render(); h.setFocused(true); },
    h => { h.unmount(); },
  ]) {
    const pending = deferred(); const h = harness({ update: () => pending.promise }); await h.mount();
    const dialog = await review(h, dirtyDownloads(h)); const work = confirm(dialog);
    assert.equal(h.writes.length, 1); expire(h); pending.resolve(); await work; await settle();
    assert.equal(h.writes.length, 1); assert.deepEqual(h.navigation, []);
  }
});

test('turning password protection off clears prior draft text and sends no lingering password', async () => {
  const h = harness({ read: () => snapshot({ isPasswordProtected: true }) }); let tree = await h.mount();
  passwordField(tree).props.onChangeText('discard-this-secret'); tree = h.render();
  switchFor(tree, h.t.access.passwordProtection).props.onValueChange(false); tree = h.render();
  assert.equal(find(tree, node => node.type === 'Field' && node.props.secureTextEntry), undefined);
  const dialog = await review(h, tree); await confirm(dialog); await settle();
  assert.equal(h.writes[0].password, ''); assert.equal(h.writes[0].isPasswordProtected, false);
  assert.equal(JSON.stringify(h.alerts).includes('discard-this-secret'), false);
});

test('dirty navigation asks to discard locally, cancellation preserves draft, and discard repeats the exact removal action', async () => {
  const h = harness(); await h.mount(); dirtyDownloads(h);
  const action = { type: 'POP', fixture: 'exact-removal' }; h.remove(action);
  let dialog = h.alerts.findLast(args => args[0] === h.t.access.discardTitle);
  assert.ok(dialog); dialog[2].find(item => item.style === 'cancel').onPress();
  assert.equal(switchFor(h.render(), h.t.access.allowDownload).props.value, false);
  assert.deepEqual(h.navigation, []); h.remove(action);
  dialog = h.alerts.findLast(args => args[0] === h.t.access.discardTitle);
  dialog[2].find(item => item.style === 'destructive').onPress();
  assert.equal(h.navigation.length, 1); assert.equal(h.navigation[0][0], 'dispatch');
  assert.equal(h.navigation[0][1], action); assert.deepEqual(h.writes, []);
});

test('retained discard cannot erase a newer draft or leave after identity/focus lifetime expires', async () => {
  for (const expire of [
    h => { switchFor(h.render(), h.t.access.passwordProtection).props.onValueChange(true); },
    h => { h.emitAuth('other-owner'); h.emitAuth('owner-a'); },
    h => { h.setFocused(false); h.render(); h.setFocused(true); h.render(); },
    h => { h.unmount(); },
  ]) {
    const h = harness(); await h.mount(); dirtyDownloads(h); h.remove({ type: 'POP' });
    const dialog = h.alerts.findLast(args => args[0] === h.t.access.discardTitle); assert.ok(dialog);
    expire(h); dialog[2].find(item => item.style === 'destructive').onPress(); await settle();
    assert.deepEqual(h.navigation, []); assert.deepEqual(h.writes, []);
  }
});

test('navigation while awaiting access write stays put and has no extra dialog covering acknowledged back navigation', async () => {
  const pending = deferred(); const h = harness({ update: () => pending.promise }); await h.mount();
  const dialog = await review(h, dirtyDownloads(h)); const work = confirm(dialog); h.render();
  const alertCount = h.alerts.length; h.remove({ type: 'POP' });
  assert.deepEqual(h.navigation, []); assert.equal(h.alerts.length, alertCount);
  assert.ok(content(h.render()).includes(h.t.access.waiting));
  pending.resolve(); await work; await settle(); assert.deepEqual(h.navigation, [['back']]);
});
