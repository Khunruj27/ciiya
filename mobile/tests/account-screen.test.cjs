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
    if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}
const types = load('lib/data/types.ts');
const usageLib = load('lib/account-usage.ts', { '@/lib/data/types': types });
const actionLib = load('lib/account-actions.ts');
const dictionary = load('lib/i18n.ts', {
  '@/ctx/language': { useLanguage: () => null },
  '@/lib/language-preference': load('lib/language-preference.ts'),
  'expo-localization': { getLocales: () => [{ languageCode: 'th' }] }, '@/lib/data/types': types,
});
function find(tree, match) {
  if (!tree || typeof tree !== 'object') return;
  if (match(tree)) return tree;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const found = find(child, match); if (found) return found;
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
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

// Actual TSX/actions with hook slots, dependency commits and keyed-child cleanup.
// Native links/alerts/sign-out and owner usage reads are strictly mocked.
function harness({ locale = 'th', usage = {}, exit, language = null } = {}) {
  const t = dictionary.getDictionary(locale), scopes = new Map(), commits = [];
  const alerts = [], links = [], owners = [], refreshes = [];
  let languageState = language;
  const languageSelections = [];
  let user = { id: 'owner-a', name: 'Fixture A', email: 'a@example.invalid', avatarUrl: null };
  let epoch = 0, exits = 0, scope, childKey;
  let usageState = { data: { plan: 'starter', usedBytes: 40, limitBytes: 100 },
    authorized: true, loading: false, refreshing: false, error: null, ...usage };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  function memo(factory, deps, kind) {
    const i = scope.cursors[kind]++;
    if (!scope[kind][i] || !same(scope[kind][i].deps, deps)) scope[kind][i] = { value: factory(), deps };
    return scope[kind][i].value;
  }
  function effect(callback, deps, kind) {
    const i = scope.cursors[kind]++, slots = scope[kind], old = slots[i];
    if (old && same(old.deps, deps)) return;
    commits.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; });
  }
  const react = {
    useState(initial) {
      const i = scope.cursors.states++, local = scope;
      if (!(i in local.states)) local.states[i] = initial;
      return [local.states[i], value => { local.states[i] = value; }];
    },
    useRef(initial) { const i = scope.cursors.refs++; return scope.refs[i] ??= { current: initial }; },
    useMemo: (fn, deps) => memo(fn, deps, 'memos'),
    useEffect: (fn, deps) => effect(fn, deps, 'effects'),
    useLayoutEffect: (fn, deps) => effect(fn, deps, 'layout'),
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const Screen = load('app/(app)/account/index.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, react,
    'expo-constants': { default: { expoConfig: { version: '1.0.0' } } },
    'expo-image': { Image: 'Image' },
    'expo-linking': { openURL: async url => { links.push(url); } },
    'expo-router': { useIsFocused: () => true },
    'react-native': { ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl',
      ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: value => value, absoluteFill: {} },
      Alert: { alert: (...args) => alerts.push(args) } },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ui': { Button: 'Button', Card: 'Card', Segmented: 'Segmented', StateView: 'StateView', formatBytes: n => `${n} B` },
    '@/constants/theme': { Radius: { pill: 999 }, Spacing: { half: 2, one: 4, two: 8, three: 16 } },
    '@/ctx/session': { useSession: () => ({ user, signOut: async () => { exits++; if (exit) await exit(); } }) },
    '@/ctx/language': { useLanguage: () => languageState && ({ ...languageState,
      selectLanguage: async preference => {
        languageSelections.push(preference);
        languageState = { ...languageState, preference,
          locale: resolveSelectedLocale(preference), saving: false, saveFailed: false };
      },
    }) },
    '@/hooks/use-account-usage': { useAccountUsage: id => {
      owners.push(id); return { ...usageState, refresh: async () => { refreshes.push(id); } };
    } },
    '@/hooks/use-album-cover-guard': { useAlbumCoverGuard: () => {
      const renderedEpoch = epoch, local = scope;
      const capture = memo(() => () => {
        if (!local.alive || epoch !== renderedEpoch || !user || !usageState.authorized) return null;
        return () => local.alive && epoch === renderedEpoch && Boolean(user) && usageState.authorized;
      }, [epoch], 'memos');
      return { available: Boolean(user && usageState.authorized), capture };
    } },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/config': { isDemoMode: false, SITE_URL: 'https://ciiya.example.invalid' },
    '@/lib/account-actions': actionLib, '@/lib/account-usage': usageLib,
    '@/lib/i18n': { ...dictionary, useT: () => dictionary.getDictionary(languageState?.locale ?? locale) },
  }).default;
  function render(fn, props, key) {
    scope = scopes.get(key);
    if (!scope) { scope = { states: [], refs: [], memos: [], effects: [], layout: [], alive: true }; scopes.set(key, scope); }
    scope.cursors = { states: 0, refs: 0, memos: 0, effects: 0, layout: 0 };
    return fn(props);
  }
  function clean(local) { if (!local) return; local.alive = false;
    for (const kind of ['layout', 'effects']) for (const item of local[kind]) item?.cleanup?.();
  }
  return {
    t, alerts, links, owners, refreshes, languageSelections, exits: () => exits,
    wrapper() { return render(Screen, undefined, 'root'); },
    render() {
      const wrapper = render(Screen, undefined, 'root');
      if (childKey !== undefined && childKey !== wrapper.key) { clean(scopes.get(childKey)); scopes.delete(childKey); }
      childKey = wrapper.key;
      const tree = render(wrapper.type, wrapper.props, childKey);
      while (commits.length) commits.shift()();
      return tree;
    },
    setUsage(patch) { usageState = { ...usageState, ...patch }; },
    setUser(id) { epoch++; user = id === null ? null : { id, name: `Fixture ${id}`, email: `${id}@example.invalid`, avatarUrl: null }; },
    identityLifetimeChange() { epoch += 2; },
    unmount() { scopes.forEach(clean); },
  };
  function resolveSelectedLocale(preference) { return preference === 'system' ? locale : preference; }
}
function button(tree, label) { const found = find(tree, node => node.type === 'Button' && node.props.label === label);
  assert.ok(found, `Missing button ${label}`); return found; }

test('owner can switch app language on the account screen without sign-out or remote actions', async () => {
  const h = harness({ language: { preference: 'system', locale: 'th', saving: false, saveFailed: false } });
  let tree = h.render();
  const selector = find(tree, node => node.type === 'Segmented');
  assert.equal(selector.props.value, 'system');
  assert.equal(selector.props.disabled, false);
  await selector.props.onChange('en');
  tree = h.render();
  assert.ok(content(tree).includes('App language'));
  button(tree, 'Sign out');
  assert.deepEqual(h.languageSelections, ['en']);
  assert.equal(h.exits(), 0); assert.deepEqual(h.links, []);
  assert.deepEqual(h.refreshes, []);
  h.setUser('owner-b'); h.render();
  await selector.props.onChange('th');
  assert.deepEqual(h.languageSelections, ['en']);
});

test('account screen is owner-keyed, shows used/remaining/read-only quota information and performs no automatic auth/link action', () => {
  const h = harness(); const first = h.wrapper(); const tree = h.render();
  assert.equal(first.props.accountId, 'owner-a');
  assert.ok(content(tree).includes('60 B'));
  assert.ok(content(tree).includes(h.t.account.quotaReadOnly));
  assert.deepEqual(h.links, []); assert.equal(h.exits(), 0); assert.deepEqual(h.alerts, []);
  h.setUser('owner-b'); const next = h.wrapper();
  assert.notEqual(next.key, first.key); assert.equal(next.props.accountId, 'owner-b');
});

test('Thai/English missing data and cached refresh failures remain explicit rather than showing Free or zero usage', () => {
  for (const locale of ['th', 'en']) {
    const h = harness({ locale, usage: { data: null, error: new types.DataError('network') } });
    const tree = h.render(); assert.ok(content(tree).includes(h.t.account.usageUnavailable));
    assert.ok(content(tree).includes(h.t.account.usageUnavailableHint));
    assert.equal(content(tree).includes('Free'), false); assert.equal(content(tree).includes('0 B'), false);
    h.setUsage({ data: { plan: 'starter', usedBytes: 40, limitBytes: 100 } });
    assert.ok(content(h.render()).includes(h.t.account.usageCached));
  }
});

test('unknown capacity has no progress bar or unlimited claim; full/near-full warnings do not change or sell a plan', () => {
  const h = harness({ usage: { data: { plan: 'internal-plan-fixture', usedBytes: 40, limitBytes: 0 } } });
  let tree = h.render(); assert.ok(content(tree).includes(h.t.account.capacityUnknown));
  assert.ok(content(tree).includes(h.t.account.unknownPlan));
  assert.equal(content(tree).includes('internal-plan-fixture'), false);
  assert.equal(find(tree, node => node.props.accessibilityRole === 'progressbar'), undefined);
  for (const [usedBytes, copy] of [[90, h.t.account.quotaNearFull], [120, h.t.account.quotaFull]]) {
    h.setUsage({ data: { plan: 'starter', usedBytes, limitBytes: 100 } }); tree = h.render();
    assert.ok(content(tree).includes(copy));
    const bar = find(tree, node => node.props.accessibilityRole === 'progressbar');
    assert.ok(bar.props.accessibilityValue.now <= 100);
  }
  assert.deepEqual(h.links, []);
});

test('loading displays a spinner without a fabricated quota card and SDK foreign-account state hides profile/usage', () => {
  const h = harness({ usage: { data: null, loading: true } });
  assert.ok(find(h.render(), node => node.type === 'ActivityIndicator'));
  h.setUsage({ authorized: false, data: { plan: 'starter', usedBytes: 40, limitBytes: 100 } });
  const tree = h.render(); assert.equal(tree.type, 'StateView');
  assert.equal(content(tree).includes('Fixture A'), false);
});

test('refresh/retry and public help links are deliberate fixed-path actions with no account query data', async () => {
  const h = harness(); const tree = h.render();
  await button(tree, h.t.account.refresh).props.onPress();
  assert.deepEqual(h.refreshes, ['owner-a']);
  for (const key of ['support', 'privacy', 'terms']) await button(tree, h.t.account[key]).props.onPress();
  assert.deepEqual(h.links, ['https://ciiya.example.invalid/support', 'https://ciiya.example.invalid/privacy', 'https://ciiya.example.invalid/terms']);
  assert.equal(h.exits(), 0);
});

test('sign-out opens an explanatory two-button dialog; cancel and Android dismissal preserve the session', () => {
  const h = harness(); const tree = h.render(); const exit = button(tree, h.t.account.signOut);
  exit.props.onPress(); assert.equal(h.exits(), 0);
  const [title, hint, buttons, options] = h.alerts[0];
  assert.equal(title, h.t.account.signOutTitle); assert.equal(hint, h.t.account.signOutHint);
  assert.equal(buttons.length, 2); assert.equal(options.cancelable, true);
  buttons[0].onPress(); exit.props.onPress();
  h.alerts[1][3].onDismiss(); assert.equal(h.exits(), 0);
});

test('rapid sign-out taps/confirmations call the provider once and disable refresh while the request is pending', async () => {
  const pending = deferred(); const h = harness({ exit: () => pending.promise });
  const exit = button(h.render(), h.t.account.signOut); exit.props.onPress(); exit.props.onPress();
  assert.equal(h.alerts.length, 1);
  h.alerts[0][2][1].onPress(); h.alerts[0][2][1].onPress();
  assert.equal(h.exits(), 1);
  assert.equal(button(h.render(), h.t.account.refresh).props.disabled, true);
  pending.resolve(); await settle();
  assert.equal(button(h.render(), h.t.account.signOut).props.loading, false);
});

test('queued sign-out confirmation and old rendered buttons cannot act after identity/focus lifetime change or unmount', async () => {
  for (const expire of [h => h.identityLifetimeChange(), h => h.setUser('owner-b'), h => h.unmount()]) {
    const h = harness(); const exit = button(h.render(), h.t.account.signOut);
    exit.props.onPress(); expire(h); h.alerts[0][2][1].onPress(); exit.props.onPress();
    await settle(); assert.equal(h.exits(), 0); assert.equal(h.alerts.length, 1);
  }
});

test('sign-out failure gives a generic local alert, not raw auth error text or an automatic retry', async () => {
  const h = harness({ exit: async () => { throw Error('private-auth-fixture'); } });
  button(h.render(), h.t.account.signOut).props.onPress(); h.alerts[0][2][1].onPress(); await settle();
  assert.equal(h.exits(), 1); assert.equal(h.alerts[1][0], h.t.account.signOutFailed);
  assert.equal(JSON.stringify(h.alerts).includes('private-auth-fixture'), false);
});
