/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the installed SDK-57 compatibility implementation rather than the
// different SDK-58 usePreventRemove({ repeat }) API. Native/React I/O is mocked.
function installed(relative, mocks) {
  const root = path.dirname(require.resolve('expo-router/package.json'));
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), {
    exports,
    require(name) {
      if (!(name in mocks)) throw Error('Unmocked SDK dependency: ' + name);
      return mocks[name];
    },
  });
  return exports;
}

test('installed SDK-57 removal hook registers native prevention, emits data.action and cleans up its listener/provider', () => {
  const effects = [], registrations = [], callbacks = [], disposals = [];
  let handler;
  const provider = { setPreventRemove: (...args) => registrations.push(args) };
  const sdk = installed('build/react-navigation/core/usePreventRemove.js', {
    'nanoid/non-secure': { nanoid: () => 'fixture-prevention' },
    react: { useState: initial => [initial()], useEffect: fn => effects.push(fn) },
    '../../utils/useLatestCallback': { __esModule: true, default: fn => fn },
    './useNavigation': { useNavigation: () => ({ addListener(name, fn) {
      assert.equal(name, 'beforeRemove');
      handler = fn;
      return () => disposals.push('listener');
    } }) },
    './usePreventRemoveContext': { usePreventRemoveContext: () => provider },
    './useRoute': { useRoute: () => ({ key: 'fixture-route' }) },
  });
  sdk.usePreventRemove(true, options => callbacks.push(options));
  const cleanup = effects.map(fn => fn());
  assert.deepEqual(registrations[0], ['fixture-prevention', 'fixture-route', true]);
  const action = { type: 'GO_BACK' };
  const data = { action };
  let prevented = 0;
  handler({ data, preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(callbacks[0].data, data);
  assert.equal(callbacks[0].data.action, action);
  cleanup.forEach(fn => fn?.());
  assert.deepEqual(registrations[1], ['fixture-prevention', 'fixture-route', false]);
  assert.deepEqual(disposals, ['listener']);

  const routerRoot = path.dirname(require.resolve('expo-router/package.json'));
  const bridge = fs.readFileSync(path.join(routerRoot, 'build/react-navigation/native/index.d.ts'), 'utf8');
  const core = fs.readFileSync(path.join(routerRoot, 'build/react-navigation/core/index.d.ts'), 'utf8');
  assert.match(bridge, /export \* from '\.\.\/core'/u);
  assert.match(core, /export \{ usePreventRemove \}/u);
  const nativeStack = fs.readFileSync(path.join(routerRoot, 'build/react-navigation/native-stack/views/NativeStackView.native.js'), 'utf8');
  assert.match(nativeStack, /preventNativeDismiss: isRemovePrevented/u);
});

test('repeating the exact installed SDK-57 removal action preserves the visited-route symbol and cannot re-prompt itself', () => {
  const sdk = installed('build/react-navigation/core/useOnPreventRemove.js', {
    react: {}, './NavigationBuilderContext': {}, './NavigationProvider': {},
  });
  const routes = [{ key: 'fixture-route' }];
  const action = { type: 'GO_BACK', source: 'fixture-route' };
  let blockedAction, prompts = 0;
  const emitter = { emit(options) {
    prompts++;
    blockedAction = options.data.action;
    return { defaultPrevented: true };
  } };
  assert.equal(sdk.shouldPreventRemove(emitter, {}, routes, [], action), true);
  assert.equal(prompts, 1);
  assert.equal(blockedAction.type, action.type);
  assert.equal(blockedAction.source, action.source);
  assert.equal(Object.getOwnPropertySymbols(blockedAction).length, 1);
  assert.equal(sdk.shouldPreventRemove(emitter, {}, routes, [], blockedAction), false);
  assert.equal(prompts, 1);
  // A freshly invented back action is not equivalent: it would re-prompt.
  assert.equal(sdk.shouldPreventRemove(emitter, {}, routes, [], { ...action }), true);
  assert.equal(prompts, 2);
});
