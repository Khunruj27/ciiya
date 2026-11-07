/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function transpile(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const geometry = {};
vm.runInNewContext(transpile('lib/photo-zoom.ts'), { exports: geometry });

test('scale is bounded and near-1x/invalid values recenter exactly', () => {
  for (const input of [-4, 0, 1, 1.005, NaN, Infinity]) assert.equal(geometry.clampZoom(input), 1);
  assert.equal(geometry.clampZoom(1.5), 1.5);
  assert.equal(geometry.clampZoom(40), 4);
});

test('contain geometry preserves portrait, landscape and unknown dimensions', () => {
  assert.deepEqual({ ...geometry.containSize(4000, 2000, 400, 800) }, { width: 400, height: 200 });
  assert.deepEqual({ ...geometry.containSize(2000, 4000, 400, 800) }, { width: 400, height: 800 });
  assert.deepEqual({ ...geometry.containSize(null, null, 400, 800) }, { width: 400, height: 800 });
});

test('panning clamps edges, letterbox axes and non-finite offsets', () => {
  assert.equal(geometry.clampPhotoOffset(900, 800, 400), 200);
  assert.equal(geometry.clampPhotoOffset(-900, 800, 400), -200);
  assert.equal(geometry.clampPhotoOffset(20, 200, 800), 0);
  assert.equal(geometry.clampPhotoOffset(Infinity, 800, 400), 0);
});

test('pinch keeps the original image point under the moving focal point', () => {
  const startOffset = 30, startScale = 2, nextScale = 3, startFocal = 250, movedFocal = 280, viewport = 400;
  const next = geometry.pinchPhotoOffset(startOffset, startScale, nextScale, startFocal, movedFocal, viewport);
  const beforeImagePoint = (startFocal - viewport / 2 - startOffset) / startScale;
  const afterImagePoint = (movedFocal - viewport / 2 - next) / nextScale;
  assert.equal(beforeImagePoint, afterImagePoint);
});

test('adjacent navigation stays within loaded photos, regardless of a larger reported total', () => {
  assert.equal(geometry.adjacentPhotoIndex(0, -1, 48), null);
  assert.equal(geometry.adjacentPhotoIndex(0, 1, 48), 1);
  assert.equal(geometry.adjacentPhotoIndex(46, 1, 48), 47);
  assert.equal(geometry.adjacentPhotoIndex(47, 1, 48), null);
  assert.equal(geometry.adjacentPhotoIndex(47, 1, 58), 48);
  for (const index of [-1, 48, NaN, Infinity, 1.5]) {
    assert.equal(geometry.adjacentPhotoIndex(index, 1, 48), null);
  }
  for (const count of [0, -1, NaN, Infinity, 1.5]) {
    assert.equal(geometry.adjacentPhotoIndex(0, 1, count), null);
  }
  assert.equal(geometry.adjacentPhotoIndex(1, 2, 48), null);
});

test('native page selection bounds bounce and ignores invalid or empty geometry', () => {
  assert.equal(geometry.photoIndexFromOffset(-30, 400, 48), 0);
  assert.equal(geometry.photoIndexFromOffset(600, 400, 48), 2);
  assert.equal(geometry.photoIndexFromOffset(99999, 400, 48), 47);
  for (const offset of [NaN, Infinity]) assert.equal(geometry.photoIndexFromOffset(offset, 400, 48), null);
  for (const width of [0, -1, NaN, Infinity]) assert.equal(geometry.photoIndexFromOffset(400, width, 48), null);
  assert.equal(geometry.photoIndexFromOffset(400, 400, 0), null);
});

// Mock only React/native/gesture bindings. These tests exercise the actual
// component callbacks without loading native modules or contacting services.
function harness(platform = 'android', { zoomScale = 1, dimensions = { width: 400, height: 800 } } = {}) {
  const callbacks = [], cleanup = [], reports = [], scheduled = [], shared = [];
  const refs = [], states = [], memos = [], callbackMemos = [], effects = [], layoutEffects = [];
  let refCursor = 0, stateCursor = 0, sharedCursor = 0, memoCursor = 0, callbackCursor = 0;
  let effectCursor = 0, layoutCursor = 0;
  const pendingLayout = [], pendingEffects = [];
  const sameDependencies = (before, after) => before !== undefined && after !== undefined &&
    before.length === after.length && before.every((value, i) => Object.is(value, after[i]));
  function memoize(slots, slot, factory, dependencies) {
    if (!(slot in slots) || !sameDependencies(slots[slot].dependencies, dependencies)) {
      slots[slot] = { value: factory(), dependencies };
    }
    return slots[slot].value;
  }
  function enqueueEffect(slots, slot, fn, dependencies, pending) {
    if (slot in slots && sameDependencies(slots[slot].dependencies, dependencies)) return;
    const previous = slots[slot];
    const effect = { dependencies, dispose: undefined };
    slots[slot] = effect;
    pending.push(() => {
      previous?.dispose?.();
      effect.dispose = fn();
    });
    if (!previous) cleanup.push(() => slots[slot]?.dispose?.());
  }
  function build(kind) {
    const target = { kind, config: {} };
    const proxy = new Proxy(target, { get(object, key) {
      if (key in object) return object[key];
      return (...args) => { object.config[key] = args.length === 1 ? args[0] : args; return proxy; };
    } });
    return proxy;
  }
  const create = (type, props, key) => ({ type, props, key });
  const mocks = {
    'react/jsx-runtime': { jsx: create, jsxs: create },
    react: {
      useCallback: (fn, dependencies) => memoize(callbackMemos, callbackCursor++, () => fn, dependencies),
      useMemo: (fn, dependencies) => memoize(memos, memoCursor++, fn, dependencies),
      useRef(current) {
        const slot = refCursor++;
        return refs[slot] ??= { current };
      },
      useState(initial) {
        const slot = stateCursor++;
        if (!(slot in states)) states[slot] = typeof initial === 'number' && initial === 1 ? zoomScale : initial;
        return [states[slot], value => {
          callbacks.push(value);
          states[slot] = typeof value === 'function' ? value(states[slot]) : value;
        }];
      },
      useEffect(fn, dependencies) { enqueueEffect(effects, effectCursor++, fn, dependencies, pendingEffects); },
      useLayoutEffect(fn, dependencies) { enqueueEffect(layoutEffects, layoutCursor++, fn, dependencies, pendingLayout); },
    },
    'react-native': {
      Platform: { OS: platform }, StyleSheet: { create: value => value },
      useWindowDimensions: () => dimensions,
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map(name => [name, name])),
    },
    'react-native-gesture-handler': {
      Gesture: { Native: () => build('native'), Pinch: () => build('pinch'), Pan: () => build('pan'), Simultaneous: (...gestures) => ({ gestures }) },
      GestureDetector: 'GestureDetector', GestureHandlerRootView: 'GestureHandlerRootView',
    },
    'react-native-reanimated': {
      __esModule: true, default: { View: 'AnimatedView' }, useAnimatedStyle: fn => fn(),
      useSharedValue(value) {
        const slot = sharedCursor++;
        if (slot in shared) return shared[slot];
        if (slot === 0) value = zoomScale;
        const item = { get: () => value, set: next => { value = next; } };
        shared[slot] = item; return item;
      },
    },
    'react-native-worklets': { scheduleOnRN: (fn, ...args) => scheduled.push(() => fn(...args)) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-image': { Image: 'Image' }, 'expo-status-bar': { StatusBar: 'StatusBar' },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@/constants/theme': { Radius: { pill: 999 }, Spacing: { two: 8, three: 12, four: 16 } },
    '@/lib/i18n': { useT: () => ({ common: { close: 'Close' }, viewer: {
      zoomIn: 'Zoom in', zoomOut: 'Zoom out', resetZoom: 'Reset zoom',
      previousPhoto: 'Previous photo', nextPhoto: 'Next photo',
      counter: (index, total) => `${index}/${total}`, setCover: 'Set cover',
      settingCover: 'Saving cover', coverSet: 'Cover set', coverFailed: 'Cover failed',
      coverUnavailable: 'Cover not enabled yet',
    } }) },
    '@/lib/photo-zoom': geometry,
  };
  const exports = {};
  vm.runInNewContext(transpile('components/photo-viewer.tsx') + '\nexports.zoom = ZoomablePhoto;', {
    exports, require(name) {
      if (!(name in mocks)) throw Error('Unmocked module: ' + name);
      return mocks[name];
    },
  });
  const props = {
    photo: { id: 'photo', width: 400, height: 800, previewUrl: 'https://mock.invalid/photo', filename: 'Photo' },
    width: 400, height: 800, active: true, activationVersion: 0, pagerGesture: build('native'),
    isCurrentActivation: () => true,
    onZoomStateChange: (key, locked) => reports.push({ key, locked }),
  };
  return {
    exports, props, shared, cleanup, reports, scheduled, callbacks,
    render(fn, props) {
      refCursor = stateCursor = sharedCursor = memoCursor = callbackCursor = effectCursor = layoutCursor = 0;
      const tree = fn(props);
      while (pendingLayout.length) pendingLayout.shift()();
      while (pendingEffects.length) pendingEffects.shift()();
      return tree;
    },
    unmount() { cleanup.forEach(fn => fn()); },
    flush() { while (scheduled.length) scheduled.shift()(); },
  };
}
function find(element, match) {
  if (!element || typeof element !== 'object') return;
  if (match(element)) return element;
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = find(child, match); if (found) return found;
  }
}
function gestures(h, props = h.props) {
  const tree = h.render(h.exports.zoom, props);
  const detector = find(tree, node => node.type === 'GestureDetector');
  return { tree, pinch: detector.props.gesture.gestures[0], pan: detector.props.gesture.gestures[1], detector };
}
function transform(tree) {
  const image = find(tree, node => node.type === 'AnimatedView');
  return Object.fromEntries(image.props.style.find(style => style?.transform).transform
    .map(value => Object.entries(value)[0]));
}

test('both OSes use a stationary viewport without nested native ScrollView gesture conflict', () => {
  for (const platform of ['android', 'ios']) {
    const h = harness(platform);
    const { tree, detector, pinch, pan } = gestures(h);
    assert.equal(find(tree, node => node.type === 'ScrollView'), undefined);
    assert.equal(detector.props.children.type, 'View');
    assert.equal(pinch.config.simultaneousWithExternalGesture, h.props.pagerGesture);
    assert.equal(pan.config.simultaneousWithExternalGesture, h.props.pagerGesture);
    assert.equal(pinch.config.blocksExternalGesture, undefined);
    assert.equal(pan.config.blocksExternalGesture, undefined);
    assert.equal(pan.config.manualActivation, undefined);
  }
});

test('temporary Demo instrumentation and isolation are completely removed', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/photo-viewer.tsx'), 'utf8');
  assert.doesNotMatch(source, /viewerDiagnostics|DiagnosticGestureBoundary|onViewportTouch|viewer-debug|isDemoMode/);
});

test('accessible previous/next select native offsets, release zoom and ignore repeated or foreign photo callbacks', () => {
  const h = harness('ios'), scrolls = [];
  const photos = ['first', 'photo', 'third', 'fourth'].map(id => ({ ...h.props.photo, id }));
  const props = { photos, initialIndex: 1, total: 4, onEndReached() {} };
  let tree = h.render(h.exports.PhotoViewer, props);
  const pager = find(tree, node => node.type === 'FlatList');
  pager.props.ref.current = { scrollToOffset: params => scrolls.push(params) };
  const oldZoom = pager.props.renderItem({ item: photos[1] }).props.onZoomStateChange;
  oldZoom('photo:400:800', true);
  tree = h.render(h.exports.PhotoViewer, props);
  assert.equal(find(tree, node => node.type === 'FlatList').props.scrollEnabled, false);
  const next = find(tree, node => node.props?.accessibilityLabel === 'Next photo');
  next.props.onPress();
  assert.deepEqual({ ...scrolls.at(-1) }, { offset: 800, animated: false });
  const calls = scrolls.length;
  next.props.onPress(); // An event queued before the next render is still the old photo.
  oldZoom('photo:400:800', true);
  assert.equal(scrolls.length, calls);
  tree = h.render(h.exports.PhotoViewer, props);
  assert.equal(find(tree, node => node.type === 'FlatList').props.scrollEnabled, true);
  assert.ok(find(tree, node => node.props?.children === '3/4'));
  const item = find(tree, node => node.type === 'FlatList').props.renderItem({ item: photos[2] });
  assert.equal(item.key, 'third:400:800');
  find(tree, node => node.props?.accessibilityLabel === 'Previous photo').props.onPress();
  assert.deepEqual({ ...scrolls.at(-1) }, { offset: 400, animated: false });
  tree = h.render(h.exports.PhotoViewer, props);
  assert.ok(find(tree, node => node.props?.children === '2/4'));
});

test('navigation never reaches an unloaded total and buttons expose disabled boundary states', () => {
  for (const initialIndex of [0, 47]) {
    const h = harness('ios'), scrolls = [];
    const photos = Array.from({ length: 48 }, (_, i) => ({ ...h.props.photo, id: `p${i}` }));
    const tree = h.render(h.exports.PhotoViewer, { photos, initialIndex, total: 58, onEndReached() {} });
    find(tree, node => node.type === 'FlatList').props.ref.current = { scrollToOffset: value => scrolls.push(value) };
    const label = initialIndex === 0 ? 'Previous photo' : 'Next photo';
    const button = find(tree, node => node.props?.accessibilityLabel === label);
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.accessibilityState.disabled, true);
    button.props.onPress();
    assert.equal(scrolls.length, 0);
  }
  const h = harness();
  const empty = h.render(h.exports.PhotoViewer, { photos: [], initialIndex: 0, total: 0, onEndReached() {} });
  assert.equal(find(empty, node => node.props?.accessibilityLabel === 'Previous photo').props.disabled, true);
  assert.equal(find(empty, node => node.props?.accessibilityLabel === 'Next photo').props.disabled, true);
});

test('near-edge button navigation prefetches once per loaded count and uses the newly loaded pages', () => {
  const h = harness('ios'), scrolls = [];
  let requests = 0;
  let photos = Array.from({ length: 48 }, (_, i) => ({ ...h.props.photo, id: `p${i}` }));
  const props = () => ({ photos, initialIndex: 44, total: 58, onEndReached() { requests++; } });
  let tree = h.render(h.exports.PhotoViewer, props());
  find(tree, node => node.type === 'FlatList').props.ref.current = { scrollToOffset: value => scrolls.push(value) };
  assert.equal(requests, 0);
  for (const page of [45, 46, 47]) {
    find(tree, node => node.props?.accessibilityLabel === 'Next photo').props.onPress();
    tree = h.render(h.exports.PhotoViewer, props());
    assert.equal(scrolls.at(-1).offset, page * 400);
    assert.equal(requests, 1);
  }
  assert.equal(find(tree, node => node.props?.accessibilityLabel === 'Next photo').props.disabled, true);
  photos = Array.from({ length: 58 }, (_, i) => ({ ...h.props.photo, id: `p${i}` }));
  tree = h.render(h.exports.PhotoViewer, props());
  for (let page = 48; page < 58; page++) {
    const next = find(tree, node => node.props?.accessibilityLabel === 'Next photo');
    assert.equal(next.props.disabled, false);
    next.props.onPress();
    tree = h.render(h.exports.PhotoViewer, props());
    assert.equal(scrolls.at(-1).offset, page * 400);
  }
  assert.equal(requests, 1);
  assert.equal(find(tree, node => node.props?.accessibilityLabel === 'Next photo').props.disabled, true);
});

test('native events use the latest loaded pages, reject malformed offsets and cannot select an old rotated pager', () => {
  const dimensions = { width: 400, height: 800 }, h = harness('ios', { dimensions });
  let photos = Array.from({ length: 48 }, (_, i) => ({ ...h.props.photo, id: `p${i}` }));
  const props = () => ({ photos, initialIndex: 0, total: 58, onEndReached() {} });
  const first = h.render(h.exports.PhotoViewer, props());
  const oldScroll = find(first, node => node.type === 'FlatList').props.onScroll;
  photos = Array.from({ length: 58 }, (_, i) => ({ ...h.props.photo, id: `p${i}` }));
  h.render(h.exports.PhotoViewer, props());
  oldScroll({ nativeEvent: { contentOffset: { x: 57 * 400 } } });
  let tree = h.render(h.exports.PhotoViewer, props());
  assert.ok(find(tree, node => node.props?.children === '58/58'));
  oldScroll({ nativeEvent: { contentOffset: { x: NaN } } });
  tree = h.render(h.exports.PhotoViewer, props());
  assert.ok(find(tree, node => node.props?.children === '58/58'));
  dimensions.width = 800; dimensions.height = 400;
  tree = h.render(h.exports.PhotoViewer, props());
  assert.equal(find(tree, node => node.type === 'FlatList').key, '800:400');
  oldScroll({ nativeEvent: { contentOffset: { x: 400 } } });
  tree = h.render(h.exports.PhotoViewer, props());
  assert.ok(find(tree, node => node.props?.children === '58/58'));
  find(tree, node => node.type === 'FlatList').props.onScroll({ nativeEvent: { contentOffset: { x: 800 } } });
  tree = h.render(h.exports.PhotoViewer, props());
  assert.ok(find(tree, node => node.props?.children === '2/58'));
});

test('midpoint page selection and reversal preserve each image identity while actions follow the visible page', () => {
  const h = harness('ios');
  const photos = ['photo', 'second', 'third'].map(id => ({ ...h.props.photo, id }));
  const props = { photos, initialIndex: 0, total: 3, onEndReached() {} };
  const pagerFrom = tree => find(tree, node => node.type === 'FlatList');
  const childrenFrom = tree => photos.map(item => pagerFrom(tree).props.renderItem({ item }));
  let tree = h.render(h.exports.PhotoViewer, props);
  const originalKeys = childrenFrom(tree).map(child => child.key);
  assert.deepEqual(originalKeys, photos.map(photo => `${photo.id}:400:800`));
  const scroll = pagerFrom(tree).props.onScroll;
  for (const [offset, visibleIndex] of [[199, 0], [200, 1], [399, 1], [199, 0]]) {
    scroll({ nativeEvent: { contentOffset: { x: offset } } });
    tree = h.render(h.exports.PhotoViewer, props);
    const children = childrenFrom(tree);
    assert.deepEqual(children.map(child => child.key), originalKeys);
    assert.deepEqual(children.map(child => child.props.active), photos.map((_, index) => index === visibleIndex));
    assert.ok(find(tree, node => node.props?.children === `${visibleIndex + 1}/3`));
  }
});

test('a prior page activation cannot relock or unlock the same photo after a batched away-and-back swipe', () => {
  const h = harness('ios'), scrolls = [];
  const photos = ['photo', 'second'].map(id => ({ ...h.props.photo, id }));
  const props = { photos, initialIndex: 0, total: 2, onEndReached() {} };
  let tree = h.render(h.exports.PhotoViewer, props);
  let pager = find(tree, node => node.type === 'FlatList');
  pager.props.ref.current = { scrollToOffset: params => scrolls.push(params) };
  const previousActivation = pager.props.renderItem({ item: photos[0] }).props.onZoomStateChange;
  pager.props.onScroll({ nativeEvent: { contentOffset: { x: 240 } } });
  pager.props.onScroll({ nativeEvent: { contentOffset: { x: 160 } } });
  // The photo id is the same again, but neither intervening selection committed.
  previousActivation('photo:400:800', true);
  assert.equal(scrolls.length, 0);
  tree = h.render(h.exports.PhotoViewer, props);
  pager = find(tree, node => node.type === 'FlatList');
  assert.equal(pager.props.scrollEnabled, true);
  pager.props.renderItem({ item: photos[0] }).props.onZoomStateChange('photo:400:800', true);
  assert.equal(scrolls.length, 1);
  previousActivation('photo:400:800', false);
  previousActivation('photo:400:800', true);
  tree = h.render(h.exports.PhotoViewer, props);
  assert.equal(find(tree, node => node.type === 'FlatList').props.scrollEnabled, false);
  assert.equal(scrolls.length, 1);
});

test('queued photo reports and zoom buttons do not mutate child state before a new parent selection commits', () => {
  const parent = harness('ios'), child = harness('ios'), scrolls = [];
  const photos = ['photo', 'second'].map(id => ({ ...parent.props.photo, id }));
  const props = { photos, initialIndex: 0, total: 2, onEndReached() {} };
  let tree = parent.render(parent.exports.PhotoViewer, props);
  let pager = find(tree, node => node.type === 'FlatList');
  pager.props.ref.current = { scrollToOffset: params => scrolls.push(params) };
  const oldChildProps = pager.props.renderItem({ item: photos[0] }).props;
  const old = gestures(child, oldChildProps);
  old.pinch.config.onStart({ focalX: 200, focalY: 400 });
  old.pinch.config.onUpdate({ scale: 2, focalX: 200, focalY: 400, numberOfPointers: 2 });
  old.pinch.config.onFinalize();
  const before = child.shared.slice(0, 3).map(value => value.get());
  const stateChanges = child.callbacks.length;
  pager.props.onScroll({ nativeEvent: { contentOffset: { x: 240 } } });
  pager.props.onScroll({ nativeEvent: { contentOffset: { x: 160 } } });
  // Child refs still describe the old activation until React commits the new
  // parent/child props. The live parent predicate must fence local mutation too.
  child.flush();
  find(old.tree, node => node.props?.accessibilityLabel === 'Zoom in').props.onPress();
  find(old.tree, node => node.props?.accessibilityLabel === 'Reset zoom').props.onPress();
  assert.deepEqual(child.shared.slice(0, 3).map(value => value.get()), before);
  assert.equal(child.callbacks.length, stateChanges);
  assert.equal(scrolls.length, 0);
  tree = parent.render(parent.exports.PhotoViewer, props);
  pager = find(tree, node => node.type === 'FlatList');
  const currentChildProps = pager.props.renderItem({ item: photos[0] }).props;
  gestures(child, currentChildProps);
  const current = gestures(child, currentChildProps);
  assert.deepEqual(transform(current.tree), { translateX: 0, translateY: 0, scale: 1 });
  find(current.tree, node => node.props?.accessibilityLabel === 'Zoom in').props.onPress();
  assert.equal(child.shared[0].get(), 2);
  assert.equal(scrolls.length, 1);
});

test('queued cover and next buttons cannot act on a later visit to the same photo before React commits', async () => {
  const h = harness('ios'), saved = [], scrolls = [];
  const photos = ['photo', 'second'].map(id => ({ ...h.props.photo, id, isReady: true }));
  const props = {
    coverAvailable: true,
    photos, initialIndex: 0, total: 2, onEndReached() {},
    async onSetCover(photo) { saved.push(photo.id); },
  };
  let tree = h.render(h.exports.PhotoViewer, props);
  const pager = find(tree, node => node.type === 'FlatList');
  pager.props.ref.current = { scrollToOffset: params => scrolls.push(params) };
  const oldCover = find(tree, node => node.props?.accessibilityLabel === 'Set cover');
  const oldNext = find(tree, node => node.props?.accessibilityLabel === 'Next photo');
  pager.props.onScroll({ nativeEvent: { contentOffset: { x: 240 } } });
  pager.props.onScroll({ nativeEvent: { contentOffset: { x: 160 } } });
  await oldCover.props.onPress();
  oldNext.props.onPress();
  assert.deepEqual(saved, []);
  assert.deepEqual(scrolls, []);
  tree = h.render(h.exports.PhotoViewer, props);
  assert.ok(find(tree, node => node.props?.children === '1/2'));
  await find(tree, node => node.props?.accessibilityLabel === 'Set cover').props.onPress();
  assert.deepEqual(saved, ['photo']);
  find(tree, node => node.props?.accessibilityLabel === 'Next photo').props.onPress();
  assert.equal(scrolls.at(-1).offset, 400);
});

test('queued cover buttons cannot save an old photo after button or native-page navigation', async () => {
  for (const navigation of ['button', 'native']) {
    const h = harness('ios'), saved = [];
    const photos = ['first', 'photo', 'third'].map(id => ({ ...h.props.photo, id, isReady: true }));
    const props = {
      coverAvailable: true,
      photos, initialIndex: 1, total: 3, onEndReached() {},
      async onSetCover(photo) { saved.push(photo.id); },
    };
    let tree = h.render(h.exports.PhotoViewer, props);
    const pager = find(tree, node => node.type === 'FlatList');
    pager.props.ref.current = { scrollToOffset() {} };
    const oldCover = find(tree, node => node.props?.accessibilityLabel === 'Set cover');
    if (navigation === 'button') {
      find(tree, node => node.props?.accessibilityLabel === 'Next photo').props.onPress();
    } else {
      pager.props.onScroll({ nativeEvent: { contentOffset: { x: 800 } } });
    }
    await oldCover.props.onPress(); // No React commit has happened yet.
    assert.deepEqual(saved, []);
    tree = h.render(h.exports.PhotoViewer, props);
    assert.ok(find(tree, node => node.props?.children === '3/3'));
    await find(tree, node => node.props?.accessibilityLabel === 'Set cover').props.onPress();
    assert.deepEqual(saved, ['third']);
  }
});

test('cover writes are synchronously single-flight and a success rejects repeats before its UI commits', async () => {
  const h = harness('ios'), saved = [];
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const photos = [{ ...h.props.photo, isReady: true }];
  const props = {
    coverAvailable: true,
    photos, initialIndex: 0, total: 1, onEndReached() {},
    onSetCover(photo) { saved.push(photo.id); return pending; },
  };
  let tree = h.render(h.exports.PhotoViewer, props);
  const original = find(tree, node => node.props?.accessibilityLabel === 'Set cover');
  const first = original.props.onPress();
  await original.props.onPress();
  assert.deepEqual(saved, ['photo']);
  tree = h.render(h.exports.PhotoViewer, props);
  const saving = find(tree, node => node.props?.accessibilityLabel === 'Saving cover');
  assert.equal(saving.props.disabled, true);
  assert.equal(saving.props.accessibilityState.disabled, true);
  complete();
  await first;
  await original.props.onPress(); // Still an idle-state closure from the first render.
  assert.deepEqual(saved, ['photo']);
  tree = h.render(h.exports.PhotoViewer, props);
  const done = find(tree, node => node.props?.accessibilityLabel === 'Cover set');
  assert.equal(done.props.disabled, true);
});

test('a failed cover write releases the synchronous fence for an intentional retry', async () => {
  const h = harness('ios');
  let requests = 0;
  const props = {
    coverAvailable: true,
    photos: [{ ...h.props.photo, isReady: true }], initialIndex: 0, total: 1, onEndReached() {},
    onSetCover() {
      if (++requests === 1) throw Error('Mock refusal');
      return Promise.resolve();
    },
  };
  let tree = h.render(h.exports.PhotoViewer, props);
  const original = find(tree, node => node.props?.accessibilityLabel === 'Set cover');
  await original.props.onPress();
  tree = h.render(h.exports.PhotoViewer, props);
  const failed = find(tree, node => node.props?.accessibilityLabel === 'Cover failed');
  assert.equal(failed.props.disabled, false);
  const retry = failed.props.onPress();
  await failed.props.onPress();
  await retry;
  assert.equal(requests, 2);
  tree = h.render(h.exports.PhotoViewer, props);
  assert.ok(find(tree, node => node.props?.accessibilityLabel === 'Cover set'));
});

test('an accepted cover write retains its original photo and completion never labels the new page as saved', async () => {
  const h = harness('ios'), saved = [];
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const photos = ['photo', 'second'].map(id => ({ ...h.props.photo, id, isReady: true }));
  const props = {
    coverAvailable: true,
    photos, initialIndex: 0, total: 2, onEndReached() {},
    onSetCover(photo) { saved.push(photo.id); return saved.length === 1 ? pending : Promise.resolve(); },
  };
  let tree = h.render(h.exports.PhotoViewer, props);
  find(tree, node => node.type === 'FlatList').props.ref.current = { scrollToOffset() {} };
  const oldCover = find(tree, node => node.props?.accessibilityLabel === 'Set cover');
  const accepted = oldCover.props.onPress();
  find(tree, node => node.props?.accessibilityLabel === 'Next photo').props.onPress();
  tree = h.render(h.exports.PhotoViewer, props);
  const newCover = find(tree, node => node.props?.accessibilityLabel === 'Set cover');
  assert.equal(newCover.props.disabled, true);
  await newCover.props.onPress();
  assert.deepEqual(saved, ['photo']);
  complete();
  await accepted;
  tree = h.render(h.exports.PhotoViewer, props);
  assert.equal(find(tree, node => node.props?.accessibilityLabel === 'Cover set'), undefined);
  assert.equal(find(tree, node => node.props?.accessibilityLabel === 'Set cover').props.disabled, false);
  await oldCover.props.onPress();
  assert.deepEqual(saved, ['photo']);
  await find(tree, node => node.props?.accessibilityLabel === 'Set cover').props.onPress();
  assert.deepEqual(saved, ['photo', 'second']);
});

test('cover editing fails closed by default and a queued disabled press never writes', async () => {
  const h = harness('ios');
  let writes = 0;
  const props = {
    photos: [{ ...h.props.photo, isReady: true }], initialIndex: 0, total: 1,
    onEndReached() {}, async onSetCover() { writes++; },
  };
  const tree = h.render(h.exports.PhotoViewer, props);
  const button = find(tree, node => node.props?.accessibilityLabel === 'Cover not enabled yet');
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityState.disabled, true);
  await button.props.onPress();
  assert.equal(writes, 0);
});

test('closing the cover gate fences an old enabled callback without altering photo paging', async () => {
  const h = harness('ios');
  let writes = 0;
  const props = {
    coverAvailable: true,
    photos: [{ ...h.props.photo, isReady: true }], initialIndex: 0, total: 1,
    onEndReached() {}, async onSetCover() { writes++; },
  };
  const before = h.render(h.exports.PhotoViewer, props);
  const oldButton = find(before, node => node.props?.accessibilityLabel === 'Set cover');
  const after = h.render(h.exports.PhotoViewer, { ...props, coverAvailable: false });
  await oldButton.props.onPress();
  assert.equal(writes, 0);
  assert.equal(find(after, node => node.type === 'FlatList').props.scrollEnabled, true);
  assert.ok(find(after, node => node.props?.accessibilityLabel === 'Cover not enabled yet'));
});

test('a missing account/focus capture refuses a queued cover press before any write', async () => {
  const h = harness('ios');
  let writes = 0;
  const tree = h.render(h.exports.PhotoViewer, {
    coverAvailable: true, captureCoverContext: () => null,
    photos: [{ ...h.props.photo, isReady: true }], initialIndex: 0, total: 1,
    onEndReached() {}, async onSetCover() { writes++; },
  });
  await find(tree, node => node.props?.accessibilityLabel === 'Set cover').props.onPress();
  assert.equal(writes, 0);
});

test('cover completion after a changed account/focus generation never paints a saved result', async () => {
  const h = harness('ios');
  let complete, current = true;
  const pending = new Promise(resolve => { complete = resolve; });
  const props = {
    coverAvailable: true, captureCoverContext: () => () => current,
    photos: [{ ...h.props.photo, isReady: true }], initialIndex: 0, total: 1,
    onEndReached() {}, onSetCover: () => pending,
  };
  const tree = h.render(h.exports.PhotoViewer, props);
  const write = find(tree, node => node.props?.accessibilityLabel === 'Set cover').props.onPress();
  current = false;
  complete();
  await write;
  const after = h.render(h.exports.PhotoViewer, props);
  assert.equal(find(after, node => node.props?.accessibilityLabel === 'Cover set'), undefined);
  assert.equal(find(after, node => node.props?.accessibilityLabel === 'Cover failed'), undefined);
  assert.equal(find(after, node => node.props?.accessibilityLabel === 'Set cover').props.disabled, false);
});

test('closing or unmounting the viewer fences pending cover results and queued presses', async () => {
  for (const leave of ['close', 'unmount']) {
    const h = harness('ios');
    let complete, writes = 0, closes = 0;
    const pending = new Promise(resolve => { complete = resolve; });
    const props = {
      coverAvailable: true,
      photos: [{ ...h.props.photo, isReady: true }], initialIndex: 0, total: 1,
      onEndReached() {}, onClose() { closes++; },
      onSetCover() { writes++; return pending; },
    };
    const tree = h.render(h.exports.PhotoViewer, props);
    const oldButton = find(tree, node => node.props?.accessibilityLabel === 'Set cover');
    const write = oldButton.props.onPress();
    if (leave === 'close') find(tree, node => node.props?.accessibilityLabel === 'Close').props.onPress();
    else h.unmount();
    const callbacksBefore = h.callbacks.length;
    complete();
    await write;
    await oldButton.props.onPress();
    assert.equal(writes, 1);
    assert.equal(h.callbacks.length, callbacksBefore, 'No state writes after viewer leaves');
    assert.equal(closes, leave === 'close' ? 1 : 0);
  }
});

test('at 1x pan is natively disabled without manual activation/fail, and pinch never blocks paging', () => {
  const h = harness(), { pan, pinch } = gestures(h);
  assert.equal(pan.config.enabled, false);
  assert.equal(pan.config.onTouchesDown, undefined);
  assert.equal(pan.config.manualActivation, undefined);
  assert.equal(pinch.config.blocksExternalGesture, undefined);
  assert.equal(pinch.config.requireExternalGestureToFail, undefined);
  assert.equal(pinch.config.onTouchesMove, undefined);
});

test('recognized zoom snaps the outer pager to its current page and ignores foreign callbacks', () => {
  const h = harness('ios'), scrolls = [];
  const photos = [{ ...h.props.photo, id: 'first' }, h.props.photo];
  const tree = h.render(h.exports.PhotoViewer, { photos, initialIndex: 1, total: 2 });
  const pager = find(tree, node => node.type === 'FlatList');
  pager.props.ref.current = { scrollToOffset: params => scrolls.push(params) };
  const child = pager.props.renderItem({ item: h.props.photo });
  child.props.onZoomStateChange('photo:400:800', true);
  assert.deepEqual({ ...scrolls.at(-1) }, { offset: 400, animated: false });
  child.props.onZoomStateChange('first:400:800', true);
  assert.equal(scrolls.length, 1);
  child.props.onZoomStateChange('photo:400:800', false);
  assert.equal(scrolls.length, 1);
});

test('pinch clamps at 4x, ignores one-finger focal jumps, and keeps pager locked', () => {
  const h = harness(), { pinch } = gestures(h);
  pinch.config.onStart({ focalX: 200, focalY: 400 }); h.flush();
  assert.deepEqual(h.reports.at(-1), { key: 'photo:400:800', locked: true });
  pinch.config.onUpdate({ scale: 8, focalX: 300, focalY: 500, numberOfPointers: 2 });
  assert.equal(h.shared[0].get(), 4);
  assert.equal(h.shared[1].get(), 100); assert.equal(h.shared[2].get(), 100);
  pinch.config.onUpdate({ scale: 8, focalX: 999, focalY: 999, numberOfPointers: 1 });
  assert.equal(h.shared[1].get(), 100);
  pinch.config.onFinalize(); h.flush();
  assert.equal(h.reports.at(-1).locked, true);
});

test('accessible zoom buttons enable bounded pan and 1x reset releases paging', () => {
  const initial = harness(), first = gestures(initial);
  find(first.tree, node => node.props?.accessibilityLabel === 'Zoom in').props.onPress();
  assert.equal(initial.shared[0].get(), 2);
  assert.equal(initial.reports.at(-1).locked, true);
  // The next React render enables the native pan, without a manual recognizer.
  const h = harness('ios', { zoomScale: 2 }), { tree, pan } = gestures(h);
  assert.equal(pan.config.enabled, true);
  assert.equal(pan.config.minDistance, 1);
  pan.config.onChange({ changeX: 1000, changeY: -1000 });
  assert.equal(h.shared[1].get(), 200); assert.equal(h.shared[2].get(), -400);
  find(tree, node => node.props?.accessibilityLabel === 'Reset zoom').props.onPress();
  assert.equal(h.shared[0].get(), 1);
  assert.equal(h.shared[1].get(), 0); assert.equal(h.shared[2].get(), 0);
  assert.equal(h.reports.at(-1).locked, false);
});

test('persisted image zoom and pan survive same-activation renders but reset off-screen without emitting pager unlock', () => {
  for (const platform of ['ios', 'android']) {
    const h = harness(platform);
    let page = gestures(h);
    page.pinch.config.onStart({ focalX: 200, focalY: 400 });
    page.pinch.config.onUpdate({ scale: 2, focalX: 200, focalY: 400, numberOfPointers: 2 });
    page.pinch.config.onFinalize(); h.flush();
    page = gestures(h);
    assert.equal(page.pan.config.enabled, true);
    page.pan.config.onChange({ changeX: 150, changeY: -200 });
    const sharedCount = h.shared.length;
    page = gestures(h);
    assert.deepEqual(transform(page.tree), { translateX: 150, translateY: -200, scale: 2 });
    assert.equal(h.shared.length, sharedCount);
    const reportCount = h.reports.length;
    const inactiveProps = { ...h.props, active: false, activationVersion: -1 };
    gestures(h, inactiveProps);
    page = gestures(h, inactiveProps);
    assert.deepEqual(transform(page.tree), { translateX: 0, translateY: 0, scale: 1 });
    assert.equal(page.pinch.config.enabled, false);
    assert.equal(page.pan.config.enabled, false);
    assert.equal(find(page.tree, node => node.props?.accessibilityLabel === 'Zoom in'), undefined);
    assert.equal(h.reports.length, reportCount);
    page = gestures(h, { ...h.props, activationVersion: 2 });
    assert.deepEqual(transform(page.tree), { translateX: 0, translateY: 0, scale: 1 });
    assert.equal(page.pan.config.enabled, false);
    assert.equal(find(page.tree, node => node.props?.accessibilityLabel === 'Zoom out').props.disabled, true);
    assert.equal(h.reports.length, reportCount);
  }
});

test('queued pinch reports and native worklets from an earlier activation cannot alter a reactivated image', () => {
  for (const platform of ['ios', 'android']) {
    const h = harness(platform);
    const old = gestures(h);
    old.pinch.config.onStart({ focalX: 200, focalY: 400 });
    old.pinch.config.onUpdate({ scale: 2, focalX: 300, focalY: 600, numberOfPointers: 2 });
    old.pinch.config.onFinalize();
    assert.equal(h.scheduled.length, 2);
    gestures(h, { ...h.props, active: false, activationVersion: -1 });
    let page = gestures(h, { ...h.props, activationVersion: 2 });
    h.flush();
    assert.equal(h.reports.length, 0);
    old.pinch.config.onStart({ focalX: 100, focalY: 200 });
    old.pinch.config.onUpdate({ scale: 4, focalX: 350, focalY: 700, numberOfPointers: 2 });
    old.pinch.config.onFinalize();
    old.pan.config.onChange({ changeX: 500, changeY: 500 });
    find(old.tree, node => node.props?.accessibilityLabel === 'Zoom in').props.onPress();
    find(old.tree, node => node.props?.accessibilityLabel === 'Reset zoom').props.onPress();
    h.flush();
    page = gestures(h, { ...h.props, activationVersion: 2 });
    assert.deepEqual(transform(page.tree), { translateX: 0, translateY: 0, scale: 1 });
    assert.equal(h.reports.length, 0);
    page.pinch.config.onStart({ focalX: 200, focalY: 400 });
    page.pinch.config.onUpdate({ scale: 2, focalX: 200, focalY: 400, numberOfPointers: 2 });
    page.pinch.config.onFinalize(); h.flush();
    page = gestures(h, { ...h.props, activationVersion: 2 });
    assert.deepEqual(transform(page.tree), { translateX: 0, translateY: 0, scale: 2 });
    assert.equal(h.reports.at(-1).locked, true);
    assert.equal(page.pan.config.enabled, true);
  }
});

test('a new activation resets an image even when the off-screen render was batched away', () => {
  const h = harness('ios');
  let page = gestures(h);
  find(page.tree, node => node.props?.accessibilityLabel === 'Zoom in').props.onPress();
  page = gestures(h);
  page.pan.config.onChange({ changeX: 150, changeY: -200 });
  const reportCount = h.reports.length;
  gestures(h, { ...h.props, activationVersion: 2 });
  page = gestures(h, { ...h.props, activationVersion: 2 });
  assert.deepEqual(transform(page.tree), { translateX: 0, translateY: 0, scale: 1 });
  assert.equal(page.pan.config.enabled, false);
  assert.equal(h.reports.length, reportCount);
});

test('deactivation ends an unfinished pinch so reactivated zoom can pan normally', () => {
  const h = harness('ios');
  const old = gestures(h);
  old.pinch.config.onStart({ focalX: 200, focalY: 400 });
  old.pinch.config.onUpdate({ scale: 2, focalX: 300, focalY: 600, numberOfPointers: 2 });
  gestures(h, { ...h.props, active: false, activationVersion: -1 });
  const props = { ...h.props, activationVersion: 2 };
  let page = gestures(h, props);
  h.flush();
  assert.equal(h.reports.length, 0);
  find(page.tree, node => node.props?.accessibilityLabel === 'Zoom in').props.onPress();
  page = gestures(h, props);
  assert.equal(page.pan.config.enabled, true);
  page.pan.config.onChange({ changeX: 150, changeY: -200 });
  page = gestures(h, props);
  assert.deepEqual(transform(page.tree), { translateX: 150, translateY: -200, scale: 2 });
});

test('viewer images keep contain fitting and placeholders without an active-page fade transition', () => {
  const h = harness('ios');
  const props = { ...h.props, photo: { ...h.props.photo, thumbnailUrl: 'https://mock.invalid/thumbnail' } };
  const { tree } = gestures(h, props);
  const image = find(tree, node => node.type === 'Image');
  assert.equal(image.props.contentFit, 'contain');
  assert.equal(image.props.placeholderContentFit, 'contain');
  assert.equal(image.props.placeholder.uri, props.photo.thumbnailUrl);
  assert.equal(image.props.transition, 0);
});

test('callbacks queued by an unmounted photo cannot change paging', () => {
  const h = harness(), { pinch } = gestures(h);
  pinch.config.onStart({ focalX: 200, focalY: 400 });
  h.unmount(); h.flush();
  assert.equal(h.reports.length, 0);
});

test('unmounted images ignore native gesture and zoom-button mutations as well as queued reports', () => {
  const h = harness('ios', { zoomScale: 2 });
  const old = gestures(h);
  old.pan.config.onChange({ changeX: 100, changeY: -100 });
  old.pinch.config.onStart({ focalX: 200, focalY: 400 });
  const before = h.shared.slice(0, 3).map(value => value.get());
  const stateChanges = h.callbacks.length;
  h.unmount();
  old.pinch.config.onUpdate({ scale: 2, focalX: 350, focalY: 700, numberOfPointers: 2 });
  old.pinch.config.onFinalize();
  old.pan.config.onChange({ changeX: 500, changeY: 500 });
  find(old.tree, node => node.props?.accessibilityLabel === 'Zoom in').props.onPress();
  find(old.tree, node => node.props?.accessibilityLabel === 'Reset zoom').props.onPress();
  h.flush();
  assert.deepEqual(h.shared.slice(0, 3).map(value => value.get()), before);
  assert.equal(h.callbacks.length, stateChanges);
  assert.equal(h.reports.length, 0);
});

test('iOS shares bounded pinch/pan and accessible reset, with no inner scroll recognizer', () => {
  const h = harness('ios');
  const { tree, pinch } = gestures(h);
  pinch.config.onStart({ focalX: 200, focalY: 400 });
  pinch.config.onUpdate({ scale: 2, focalX: 200, focalY: 400, numberOfPointers: 2 });
  pinch.config.onFinalize(); h.flush();
  assert.equal(h.shared[0].get(), 2);
  assert.equal(h.reports.at(-1).locked, true);
  find(tree, node => node.props?.accessibilityLabel === 'Reset zoom').props.onPress();
  assert.equal(h.shared[0].get(), 1);
  assert.equal(h.reports.at(-1).locked, false);
});

test('modal owns a gesture root and rotation remounts the pager at the visible page', () => {
  for (const platform of ['android', 'ios']) {
    const h = harness(platform);
    const tree = h.render(h.exports.PhotoViewer, { photos: [h.props.photo], initialIndex: 0, total: 1 });
    assert.ok(find(tree, node => node.type === 'GestureHandlerRootView'));
    const pager = find(tree, node => node.type === 'FlatList');
    assert.equal(pager.key, '400:800');
    assert.equal(pager.props.initialScrollIndex, 0);
    const child = pager.props.renderItem({ item: h.props.photo });
    assert.equal(child.key, 'photo:400:800');
    const native = find(tree, node => node.type === 'GestureDetector').props.gesture;
    assert.equal(native.kind, 'native');
    assert.notEqual(native.config.enabled, false);
  }
});
