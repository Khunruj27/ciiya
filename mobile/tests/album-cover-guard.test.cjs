/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function source() {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/hooks/use-album-cover-guard.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

// The actual hook runs with deterministic React commit/effect slots and fake
// SDK notifications. There are no token reads, native modules or live requests.
function harness({ userId = 'owner-a', albumId = 'owned-album', focused = true, demo = false } = {}) {
  const refs = [], states = [], memos = [], callbacks = [], effects = [], layouts = [], focusEffects = [];
  const pendingLayout = [], pendingEffects = [], pendingFocus = [], listeners = new Set(), authHistory = [];
  let cursors;
  let needsRender = false;
  let user = userId === null ? null : { id: userId };
  let routeAlbum = albumId, isFocused = focused, navigationFocused = focused;
  const sameDependencies = (a, b) => a !== undefined && b !== undefined && a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  function memo(slots, kind, factory, dependencies) {
    const index = cursors[kind]++;
    if (!(index in slots) || !sameDependencies(slots[index].dependencies, dependencies)) {
      slots[index] = { value: factory(), dependencies };
    }
    return slots[index].value;
  }
  function enqueue(slots, kind, callback, dependencies, queue) {
    const index = cursors[kind]++, previous = slots[index];
    if (previous && sameDependencies(previous.dependencies, dependencies)) return;
    const next = { callback, dependencies };
    slots[index] = next;
    queue.push(() => { previous?.dispose?.(); next.dispose = callback(); });
  }
  const mocks = {
    react: {
      useRef(current) { return refs[cursors.refs++] ??= { current }; },
      useState(initial) {
        const index = cursors.states++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], value => {
          const next = typeof value === 'function' ? value(states[index]) : value;
          if (!Object.is(states[index], next)) needsRender = true;
          states[index] = next;
        }];
      },
      useMemo: (factory, dependencies) => memo(memos, 'memos', factory, dependencies),
      useCallback: (callback, dependencies) => memo(callbacks, 'callbacks', () => callback, dependencies),
      useEffect: (callback, dependencies) => enqueue(effects, 'effects', callback, dependencies, pendingEffects),
      useLayoutEffect: (callback, dependencies) => enqueue(layouts, 'layouts', callback, dependencies, pendingLayout),
    },
    'expo-router': { useFocusEffect(callback) {
      const index = cursors.focus++, previous = focusEffects[index];
      if (previous?.callback === callback && previous.focused === navigationFocused) return;
      const next = { callback, focused: navigationFocused };
      focusEffects[index] = next;
      pendingFocus.push(() => { previous?.dispose?.(); if (next.focused) next.dispose = callback(); });
    } },
    '@/ctx/session': { useSession: () => ({ user }) },
    '@/lib/config': { isDemoMode: demo },
    '@/lib/supabase': { supabase: { auth: {
      onAuthStateChange(callback) {
        listeners.add(callback);
        authHistory.push(callback);
        return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } };
      },
      getSession() { throw new Error('The cover guard must not read or refresh tokens'); },
    }, from() { throw new Error('The cover guard must not access database rows'); } } },
  };
  const exports = {};
  vm.runInNewContext(source(), { exports, require(name) {
    if (!(name in mocks)) throw new Error('Unmocked hook dependency: ' + name);
    return mocks[name];
  } });

  return {
    listeners, authHistory,
    render() {
      let result;
      for (let pass = 0; pass < 12; pass++) {
        needsRender = false;
        cursors = Object.fromEntries(['refs', 'states', 'memos', 'callbacks', 'effects', 'layouts', 'focus'].map(kind => [kind, 0]));
        result = exports.useAlbumCoverGuard(routeAlbum, isFocused);
        for (const queue of [pendingLayout, pendingEffects, pendingFocus]) while (queue.length) queue.shift()();
        if (!needsRender) return result;
      }
      throw new Error('Cover guard commit updates did not settle');
    },
    setUser(next) { user = next === null ? null : { id: next }; },
    setAlbum(next) { routeAlbum = next; },
    setFocused(next) { isFocused = next; navigationFocused = next; },
    emitFocus(next) {
      navigationFocused = next;
      for (const entry of focusEffects) {
        entry.dispose?.(); entry.dispose = undefined; entry.focused = next;
        if (next) entry.dispose = entry.callback();
      }
    },
    emitAuth(next) {
      for (const listener of [...listeners]) listener('AUTH_EVENT', next === null ? null : { user: { id: next } });
    },
    unmount() {
      for (const slots of [layouts, effects, focusEffects]) slots.forEach(entry => entry.dispose?.());
    },
    replayEffects() {
      // React Strict Mode runs setup/cleanup/setup without replacing refs.
      for (const slots of [layouts, effects, focusEffects]) slots.forEach(entry => entry.dispose?.());
      for (const slots of [layouts, effects, focusEffects]) slots.forEach(entry => {
        if (slots !== focusEffects || entry.focused) entry.dispose = entry.callback();
      });
    },
  };
}

function capture(guard) {
  const predicate = guard.capture();
  assert.equal(typeof predicate, 'function');
  assert.equal(predicate(), true);
  return predicate;
}

test('cover guard is read-only and current only for a focused signed-in owner context', () => {
  const h = harness();
  const guard = h.render();
  assert.equal(guard.available, true);
  capture(guard);
  assert.equal(h.listeners.size, 1);
  for (const fixture of [{ userId: null }, { focused: false }, { albumId: '' }, { albumId: '  ' }]) {
    const inactive = harness(fixture).render();
    assert.equal(inactive.available, false);
    assert.equal(inactive.capture(), null);
  }
});

test('benign rerenders and same-owner SDK token events retain the captured cover context', () => {
  const h = harness();
  const predicate = capture(h.render());
  h.setUser('owner-a');
  h.render();
  h.emitAuth('owner-a');
  h.render();
  assert.equal(predicate(), true);
  assert.equal(h.listeners.size, 1);
});

test('blur and refocus permanently invalidate captures from the earlier visit', () => {
  const h = harness();
  const originalGuard = h.render();
  const previous = capture(originalGuard);
  h.setFocused(false);
  const blurred = h.render();
  assert.equal(blurred.available, false);
  assert.equal(blurred.capture(), null);
  assert.equal(previous(), false);
  h.setFocused(true);
  const resumed = h.render();
  assert.equal(resumed.available, true);
  capture(resumed);
  assert.equal(previous(), false);
  assert.equal(originalGuard.capture(), null);
});

test('album leave-and-return cannot revive predicates that would refresh a different album', () => {
  const h = harness();
  const originalGuard = h.render();
  const previous = capture(originalGuard);
  h.setAlbum('other-album');
  const other = capture(h.render());
  assert.equal(previous(), false);
  h.setAlbum('owned-album');
  capture(h.render());
  assert.equal(previous(), false);
  assert.equal(other(), false);
  assert.equal(originalGuard.capture(), null);
});

test('SDK logout or foreign-owner events fence captures before the session context rerenders', () => {
  for (const nextOwner of [null, 'owner-b']) {
    const h = harness();
    const oldGuard = h.render();
    const previous = capture(oldGuard);
    h.emitAuth(nextOwner);
    assert.equal(previous(), false);
    assert.equal(oldGuard.capture(), null);
    assert.equal(h.render().available, false);
  }
});

test('logout then the same account returning never revives an earlier capture', () => {
  const h = harness();
  const previous = capture(h.render());
  h.emitAuth(null);
  h.emitAuth('owner-a');
  const current = h.render();
  assert.equal(current.available, true);
  capture(current);
  assert.equal(previous(), false);
});

test('the original capture factory stays stale after SDK identity leave-and-return before and after React commits', () => {
  for (const nextOwner of [null, 'owner-b']) {
    const h = harness();
    const oldGuard = h.render();
    const oldPredicate = capture(oldGuard);
    h.emitAuth(nextOwner);
    h.emitAuth('owner-a');
    assert.equal(oldPredicate(), false);
    assert.equal(oldGuard.capture(), null);
    const latest = h.render();
    assert.equal(latest.available, true);
    capture(latest);
    assert.equal(oldGuard.capture(), null);
  }
});

test('native focus events invalidate queued capture factories immediately even before focused props rerender', () => {
  const h = harness();
  const oldGuard = h.render();
  const oldPredicate = capture(oldGuard);
  h.emitFocus(false);
  assert.equal(oldGuard.capture(), null);
  h.emitFocus(true);
  assert.equal(oldPredicate(), false);
  assert.equal(oldGuard.capture(), null);
  capture(h.render());
  assert.equal(oldGuard.capture(), null);
});

test('rendered account/album changes isolate new captures from every earlier context', () => {
  const h = harness();
  const previous = capture(h.render());
  h.emitAuth('owner-b');
  h.setUser('owner-b');
  const next = h.render();
  h.emitAuth('owner-b');
  const current = capture(h.render());
  assert.equal(next.available, true);
  assert.equal(previous(), false);
  h.emitAuth('owner-a');
  h.setUser('owner-a');
  h.render();
  h.emitAuth('owner-a');
  capture(h.render());
  assert.equal(previous(), false);
  assert.equal(current(), false);
});

test('signing out in the React session context hides availability even before another SDK callback', () => {
  const h = harness();
  const previous = capture(h.render());
  h.setUser(null);
  const signedOut = h.render();
  assert.equal(signedOut.available, false);
  assert.equal(signedOut.capture(), null);
  assert.equal(previous(), false);
});

test('unmount disposes subscriptions and permanently blocks retained captures, including queued auth callbacks', () => {
  const h = harness();
  const previousGuard = h.render();
  const previous = capture(previousGuard);
  const queuedCallback = h.authHistory[0];
  h.unmount();
  assert.equal(h.listeners.size, 0);
  queuedCallback('AUTH_EVENT', { user: { id: 'owner-a' } });
  assert.equal(previous(), false);
  assert.equal(previousGuard.capture(), null);
});

test('Strict Mode effect replay invalidates prior captures and ignores discarded auth listeners', () => {
  const h = harness();
  const originalGuard = h.render();
  const previous = capture(originalGuard);
  const discardedCallback = h.authHistory[0];
  h.replayEffects();
  const currentGuard = h.render();
  const current = capture(currentGuard);
  assert.equal(h.listeners.size, 1);
  assert.equal(previous(), false);
  assert.equal(originalGuard.capture(), null);
  discardedCallback('AUTH_EVENT', null);
  assert.equal(current(), true);
});

test('Demo guard relies only on its local context and never registers live SDK auth listeners', () => {
  const h = harness({ userId: 'demo-user', demo: true });
  const previous = capture(h.render());
  assert.equal(h.listeners.size, 0);
  h.setFocused(false);
  assert.equal(h.render().available, false);
  assert.equal(previous(), false);
  h.unmount();
  assert.equal(h.listeners.size, 0);
});
