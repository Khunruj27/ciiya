/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}
const review = load('lib/uploads/review.ts');
const types = load('lib/data/types.ts');
const dictionary = load('lib/i18n.ts', {
  '@/ctx/language': { useLanguage: () => null },
  '@/lib/language-preference': load('lib/language-preference.ts'),
  'expo-localization': { getLocales: () => [{ languageCode: 'th' }] },
  '@/lib/data/types': types,
});
function item(overrides = {}) {
  return {
    id: 'upload-a', ownerId: 'owner-a', albumId: 'album-a', fileName: 'example.jpg',
    localName: 'copy.jpg', fileHash: 'hash-a', sizeBytes: 100, status: 'queued',
    progress: 0, attempts: 0, failure: null, registering: false, staged: null,
    createdAt: 1, ...overrides,
  };
}
function all(tree, match) {
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.props?.children;
  return [ ...(match(tree) ? [tree] : []),
    ...(Array.isArray(children) ? children.flat(Infinity) : [children]).flatMap(child => all(child, match)) ];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  const children = tree.props?.children;
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(text).join('\n');
}

// Real TSX and controller, with native alerts/images/queue boundaries mocked.
// This checks rendered callbacks, not iPhone layout or actual upload acceptance.
function harness({ initial = [item()], locale = 'th', available = true, alertThrows = false } = {}) {
  let items = initial, epoch = 0;
  const alerts = [], retries = [], removed = [], clears = [], previews = [], guardReads = [];
  const t = dictionary.getDictionary(locale);
  const jsx = (type, props) => {
    if (typeof type === 'function') return type(props);
    return { type, props: props || {} };
  };
  const FlatList = props => jsx('FlatList', {
    ...props,
    children: [props.ListHeaderComponent, ...props.data.map(value => props.renderItem({ item: value })),
      props.data.length ? null : props.ListEmptyComponent],
  });
  const screen = load('app/(app)/(albums)/album/[id]/uploads.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: { useMemo: fn => fn() },
    'expo-image': { Image: 'Image' },
    'expo-router': { Stack: { Screen: 'Stack.Screen' }, useLocalSearchParams: () => ({ id: 'album-a' }), useIsFocused: () => true },
    'expo-symbols': { SymbolView: 'SymbolView' },
    'react-native': { FlatList, Pressable: 'Pressable', View: 'View',
      StyleSheet: { create: value => value, absoluteFill: {} },
      Alert: { alert: (...args) => { if (alertThrows) throw Error('native'); alerts.push(args); } } },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/album-delivery-panel': { AlbumDeliveryPanel: 'AlbumDeliveryPanel' },
    '@/ctx/session': { useSession: () => ({ user: { id: 'owner-a' } }) },
    '@/components/ui': { Card: 'Card', HeaderButton: 'HeaderButton', StateView: 'StateView', formatBytes: n => `${n} B` },
    '@/constants/theme': { Radius: { control: 14 }, Spacing: { half: 2, one: 4, two: 8, three: 16 } },
    '@/hooks/use-album-cover-guard': { useAlbumCoverGuard: (id, focused) => {
      guardReads.push({ id, focused });
      const renderedEpoch = epoch;
      return { available, capture: () => {
        if (!available || renderedEpoch !== epoch) return null;
        return () => available && renderedEpoch === epoch;
      } };
    } },
    '@/hooks/use-uploads': { useAlbumUploads: () => ({ items }) },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/i18n': { useT: () => t },
    '@/lib/uploads/files': { localFile: name => { previews.push(name); return { uri: `file:///mock/${name}` }; } },
    '@/lib/uploads/queue': {
      getUploads: () => items,
      retryUpload: id => retries.push(id), removeUpload: id => removed.push(id),
      clearFinishedUploads: id => clears.push(id),
    },
    '@/lib/uploads/review': review,
  }).default;
  const tree = screen();
  const header = all(tree, node => node.type === 'Stack.Screen')[0].props.options.headerRight();
  return {
    tree, header, t, alerts, retries, removed, clears, previews, guardReads,
    replace(next) { items = next; },
    leaveAndReturn() { epoch += 2; },
    button(label) { return all(tree, node => node.props.accessibilityLabel === label)[0]; },
  };
}

test('the screen renders transfer counts and foreground/processing caveats without auto actions', () => {
  const h = harness();
  assert.ok(text(h.tree).includes(h.t.uploads.queueOverview));
  assert.ok(text(h.tree).includes(h.t.uploads.foregroundHint));
  assert.ok(text(h.tree).includes(h.t.uploads.storedHint));
  for (const label of Object.values(h.t.uploads.counts)) assert.ok(text(h.tree).includes(label));
  assert.deepEqual(h.guardReads, [{ id: 'album-a', focused: true }]);
  assert.deepEqual(h.alerts, []);
  assert.deepEqual(h.retries, []);
  assert.deepEqual(h.removed, []);
  assert.deepEqual(h.clears, []);
});

test('upload header embeds direct delivery actions with an explicit completed-batch label only for fully settled queue items', () => {
  for (const [initial, complete] of [
    [[item({ status: 'done' }), item({ id: 'duplicate', status: 'duplicate' })], true],
    [[item({ status: 'done' }), item({ id: 'pending', status: 'finishing' })], false],
    [[item({ status: 'done' }), item({ id: 'failed', status: 'failed' })], false],
    [[item({ status: 'done' }), item({ id: 'held', status: 'failed', staged: { storagePath: 'legacy' } })], false],
  ]) {
    const h = harness({ initial });
    const panel = all(h.tree, node => node.type === 'AlbumDeliveryPanel')[0];
    assert.equal(panel.props.albumId, 'album-a');
    assert.equal(panel.props.accountId, 'owner-a');
    assert.equal(panel.props.compact, true);
    assert.equal(panel.props.uploadComplete, complete);
    assert.deepEqual(h.retries, []);
    assert.deepEqual(h.removed, []);
  }
});

test('delivery controls remain reachable when the local upload history is empty or cleared, not hidden behind a completed journal', () => {
  const h = harness({ initial: [] });
  const panel = all(h.tree, node => node.type === 'AlbumDeliveryPanel')[0];
  assert.ok(panel);
  assert.equal(panel.props.uploadComplete, false);
  assert.deepEqual(h.clears, []);
  assert.deepEqual(h.removed, []);
});

test('Thai and English remove buttons name the file and require cancel/confirm without remote-deletion copy', () => {
  for (const locale of ['th', 'en']) {
    const h = harness({ locale });
    h.button(h.t.uploads.removeOne('example.jpg')).props.onPress();
    assert.deepEqual(h.removed, []);
    const [title, message, buttons, options] = h.alerts[0];
    assert.equal(title, h.t.uploads.removeTitle);
    assert.equal(message, h.t.uploads.removeMessage('example.jpg'));
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].style, 'cancel');
    assert.equal(options.cancelable, true);
    buttons[0].onPress();
    buttons[1].onPress();
    assert.deepEqual(h.removed, []);
    h.button(h.t.uploads.removeOne('example.jpg')).props.onPress();
    h.alerts[1][2][1].onPress();
    assert.deepEqual(h.removed, ['upload-a']);
  }
});

test('a removal dialog cannot act on a completed item or after leaving and returning to the screen', () => {
  for (const expire of [h => h.replace([item({ status: 'done' })]), h => h.leaveAndReturn()]) {
    const h = harness();
    const oldButton = h.button(h.t.uploads.removeOne('example.jpg'));
    oldButton.props.onPress();
    expire(h);
    h.alerts[0][2][1].onPress();
    assert.deepEqual(h.removed, []);
    if (h.alerts.length === 1) oldButton.props.onPress();
    assert.equal(h.alerts.length, 1);
  }
});

test('held and missing-file items never read a local preview; held items expose no retry/remove action or raw path', () => {
  const held = item({ status: 'failed', staged: { storagePath: 'private/repair/path', uncertain: true } });
  const h = harness({ initial: [held, item({ id: 'missing', status: 'failed', failure: 'file-missing' })] });
  assert.deepEqual(h.previews, []);
  assert.ok(text(h.tree).includes(h.t.uploads.held));
  assert.ok(text(h.tree).includes(h.t.uploads.heldCount(1)));
  assert.equal(text(h.tree).includes('private/repair/path'), false);
  assert.equal(h.header, null);
  const buttons = all(h.tree, node => node.type === 'Pressable');
  assert.equal(buttons.length, 1, 'Only the unrelated missing-file item can be removed');
});

test('registration intent has a retention explanation and no removal action, even after a failed acknowledgement', () => {
  for (const status of ['finishing', 'failed']) {
    const h = harness({ initial: [item({ status, registering: true })] });
    assert.ok(text(h.tree).includes(h.t.uploads.registrationRetained));
    assert.equal(h.button(h.t.uploads.removeOne('example.jpg')), undefined);
  }
});

test('failed upload retry is an explicit separate button, not a clickable parent row', () => {
  const h = harness({ initial: [item({ status: 'failed', failure: 'network' })] });
  const button = h.button(h.t.uploads.retryOne('example.jpg'));
  assert.ok(button);
  button.props.onPress();
  assert.deepEqual(h.retries, ['upload-a']);
  assert.equal(all(h.tree, node => node.type === 'Pressable').length, 2);
  assert.equal(h.header.props.label, h.t.uploads.retryAll);
});

test('unavailable account/focus disables visible actions and refuses queued callbacks before opening a dialog', () => {
  const h = harness({ available: false, initial: [item({ status: 'failed' })] });
  for (const button of all(h.tree, node => node.type === 'Pressable')) {
    assert.equal(button.props.disabled, true);
    button.props.onPress();
  }
  h.header.props.onPress();
  assert.deepEqual(h.alerts, []);
  assert.deepEqual(h.retries, []);
  assert.deepEqual(h.removed, []);
});

test('native dialog failure and Android dismissal release the confirmation fence without queue work', () => {
  const failing = harness({ alertThrows: true });
  const oldButton = failing.button(failing.t.uploads.removeOne('example.jpg'));
  oldButton.props.onPress();
  oldButton.props.onPress();
  assert.deepEqual(failing.removed, []);
  const h = harness();
  const button = h.button(h.t.uploads.removeOne('example.jpg'));
  button.props.onPress();
  h.alerts[0][3].onDismiss();
  h.alerts[0][2][1].onPress();
  assert.deepEqual(h.removed, []);
  button.props.onPress();
  assert.equal(h.alerts.length, 2);
});

test('finished summary clearing invokes only its album-scoped queue port, never removal', () => {
  const h = harness({ initial: [item({ status: 'done' })] });
  assert.equal(h.header.props.label, h.t.uploads.clearFinished);
  h.header.props.onPress();
  assert.deepEqual(h.clears, ['album-a']);
  assert.deepEqual(h.removed, []);
  assert.deepEqual(h.previews, []);
});

test('row progress values are bounded for both visible text and accessible progressbar', () => {
  for (const [progress, expected] of [[2, 100], [-0.1, 0], [NaN, 0]]) {
    const h = harness({ initial: [item({ status: 'uploading', progress })] });
    const bar = all(h.tree, node => node.props.accessibilityRole === 'progressbar')[0];
    assert.equal(bar.props.accessibilityValue.now, expected);
    assert.ok(text(h.tree).includes(h.t.uploads.status.uploading(expected)));
  }
});
