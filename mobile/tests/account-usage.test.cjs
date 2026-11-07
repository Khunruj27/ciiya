/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, mocks = {}, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, Error, Promise, ...globals, require(name) {
    if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}
const types = load('lib/data/types.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const usage = (overrides = {}) => ({ plan: 'starter', usedBytes: 40, limitBytes: 100, ...overrides });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function harness(read) {
  const timers = new Map(), reads = [];
  let next = 0;
  const lib = load('lib/account-usage.ts', { '@/lib/data/types': types }, {
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const query = new lib.AccountUsageQuery('owner-a', owner => {
    reads.push(owner);
    return read ? read(owner, reads.length) : Promise.resolve(usage());
  });
  query.mount();
  query.setFocused(true);
  return { lib, query, reads, timers, timeout() {
    for (const value of [...timers.values()]) { assert.equal(value.ms, 30_000); value.fn(); }
  } };
}

test('quota summary reports remaining space, near-full/full and bounded percentages without altering quota', () => {
  const { lib } = harness();
  const normal = lib.summarizeStorageUsage(usage({ plan: ' Starter ' }));
  assert.equal(normal.plan, 'starter');
  assert.equal(normal.remainingBytes, 60);
  assert.equal(normal.fraction, 0.4);
  assert.equal(normal.level, 'normal');
  assert.equal(lib.summarizeStorageUsage(usage({ usedBytes: 90 })).level, 'near-full');
  for (const usedBytes of [100, 150]) {
    const full = lib.summarizeStorageUsage(usage({ usedBytes }));
    assert.equal(full.level, 'full');
    assert.equal(full.remainingBytes, 0);
    assert.equal(full.fraction, 1);
  }
});

test('zero capacity is unknown, not unlimited or an invented remaining-byte total', () => {
  const { lib } = harness();
  const result = lib.summarizeStorageUsage(usage({ limitBytes: 0 }));
  assert.equal(result.limitBytes, null);
  assert.equal(result.remainingBytes, null);
  assert.equal(result.fraction, null);
  assert.equal(result.level, 'unknown');
});

test('malformed, negative, nonfinite or oversized values never reach a quota progress bar', () => {
  const { lib } = harness();
  for (const bad of [null, {}, usage({ plan: '' }), usage({ plan: 'x'.repeat(65) }),
    usage({ usedBytes: NaN }), usage({ usedBytes: -1 }), usage({ limitBytes: Infinity }),
    usage({ limitBytes: -1 }), usage({ usedBytes: Number.MAX_SAFE_INTEGER + 1 })]) {
    assert.throws(() => lib.summarizeStorageUsage(bad), { kind: 'server' });
  }
});

test('query construction is read-only; explicit focus refresh is owner-bound and single-flight', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  assert.deepEqual(h.reads, []);
  const first = h.query.refresh();
  assert.equal(h.query.refresh(), first);
  await settle();
  assert.deepEqual(h.reads, ['owner-a']);
  assert.equal(h.timers.size, 1);
  pending.resolve(usage());
  await first;
  assert.deepEqual(plain(h.query.getSnapshot().data), usage());
  assert.equal(h.query.getSnapshot().loading, false);
  assert.equal(h.timers.size, 0);
});

test('query snapshots are stable between notifications and successful values do not alias a mutable response', async () => {
  const value = usage();
  const h = harness(() => Promise.resolve(value));
  assert.equal(h.query.getSnapshot(), h.query.getSnapshot());
  await h.query.refresh();
  value.usedBytes = 99;
  assert.equal(h.query.getSnapshot().data.usedBytes, 40);
});

test('refresh failure retains clearly stale own-account data and strips internal error messages', async () => {
  const h = harness((_owner, count) => count === 1 ? Promise.resolve(usage())
    : Promise.reject(new types.DataError('network', 'private-url-fixture')));
  await h.query.refresh();
  await h.query.refresh();
  assert.deepEqual(plain(h.query.getSnapshot().data), usage());
  assert.equal(h.query.getSnapshot().error.kind, 'network');
  assert.equal(h.query.getSnapshot().error.message, 'network');
});

test('missing initial usage and authoritative session errors do not invent a Free/0 response', async () => {
  for (const kind of ['not-found', 'unauthenticated', 'server']) {
    const h = harness(() => Promise.reject(new types.DataError(kind)));
    await h.query.refresh();
    assert.equal(h.query.getSnapshot().data, null);
    assert.equal(h.query.getSnapshot().error.kind, kind);
    assert.equal(h.query.getSnapshot().loading, false);
  }
  const h = harness((_owner, n) => n === 1 ? Promise.resolve(usage())
    : Promise.reject(new types.DataError('unauthenticated')));
  await h.query.refresh();
  await h.query.refresh();
  assert.equal(h.query.getSnapshot().data, null);
});

test('a black-holed read times out once, ignores a late answer and can be deliberately retried', async () => {
  const old = deferred();
  const h = harness((_owner, count) => count === 1 ? old.promise : Promise.resolve(usage({ usedBytes: 50 })));
  const first = h.query.refresh();
  await settle();
  h.timeout();
  await first;
  assert.equal(h.query.getSnapshot().error.kind, 'network');
  assert.equal(h.query.getSnapshot().data, null);
  assert.equal(h.timers.size, 0);
  await h.query.refresh();
  old.resolve(usage({ usedBytes: 1 }));
  await settle();
  assert.equal(h.query.getSnapshot().data.usedBytes, 50);
  assert.equal(h.reads.length, 2);
});

test('blur cancels local publication and returning starts a new read, never reviving the old one', async () => {
  const old = deferred();
  const h = harness((_owner, count) => count === 1 ? old.promise : Promise.resolve(usage({ usedBytes: 70 })));
  const first = h.query.refresh();
  await settle();
  h.query.setFocused(false);
  await first;
  assert.equal(h.timers.size, 0);
  h.query.setFocused(true);
  await h.query.refresh();
  old.resolve(usage({ usedBytes: 1 }));
  await settle();
  assert.equal(h.query.getSnapshot().data.usedBytes, 70);
});

test('SDK account transitions hide cached usage and cancel pending publication before React replaces the route', async () => {
  const slow = deferred();
  const h = harness((_owner, n) => n === 1 ? Promise.resolve(usage()) : slow.promise);
  await h.query.refresh();
  const second = h.query.refresh();
  await settle();
  h.query.observeOwner('owner-b');
  assert.equal(h.query.getSnapshot().data, null);
  assert.equal(h.query.getSnapshot().authorized, false);
  await second;
  slow.resolve(usage({ usedBytes: 99 }));
  await settle();
  await h.query.refresh();
  assert.equal(h.query.getSnapshot().data, null);
  assert.deepEqual(h.reads, ['owner-a', 'owner-a']);
});

test('SDK A → null → A is a new lifetime even when the final rendered user ID is unchanged', async () => {
  const old = deferred();
  const h = harness((_owner, n) => n === 1 ? old.promise : Promise.resolve(usage({ usedBytes: 80 })));
  const first = h.query.refresh();
  await settle();
  h.query.observeOwner('');
  h.query.observeOwner('owner-a');
  assert.equal(h.query.getSnapshot().authEpoch, 2);
  assert.equal(h.query.getSnapshot().data, null);
  await first;
  await h.query.refresh();
  old.resolve(usage({ usedBytes: 1 }));
  await settle();
  assert.equal(h.query.getSnapshot().data.usedBytes, 80);
});

test('same-owner token refresh preserves the pending read and quota cache', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  const first = h.query.refresh();
  h.query.observeOwner('owner-a');
  assert.equal(h.query.refresh(), first);
  pending.resolve(usage());
  await first;
  h.query.observeOwner('owner-a');
  assert.equal(h.query.getSnapshot().authEpoch, 0);
  assert.equal(h.query.getSnapshot().data.usedBytes, 40);
});

test('unmount/Strict Mode replay clears timers, blocks old work and allows a fresh mounted focus read', async () => {
  const old = deferred();
  const h = harness((_owner, n) => n === 1 ? old.promise : Promise.resolve(usage({ usedBytes: 60 })));
  const first = h.query.refresh();
  await settle();
  h.query.dispose();
  await first;
  assert.equal(h.timers.size, 0);
  await h.query.refresh();
  assert.equal(h.reads.length, 1);
  h.query.mount(); h.query.setFocused(true);
  await h.query.refresh();
  old.reject(Error('late-private-fixture'));
  await settle();
  assert.equal(h.query.getSnapshot().data.usedBytes, 60);
});

test('invalid response shape is a visible server error, not a zero-usage success', async () => {
  const h = harness(() => Promise.resolve({ plan: 'free', usedBytes: Infinity, limitBytes: 100 }));
  await h.query.refresh();
  assert.equal(h.query.getSnapshot().data, null);
  assert.equal(h.query.getSnapshot().error.kind, 'server');
});

function dataHarness({ owner = 'owner-a', row = {
  current_plan: 'starter', storage_used_bytes: '40', used_bytes: '1', storage_limit_bytes: '100',
}, error = null, status = 200 } = {}) {
  const reads = [];
  const query = {
    select(value) { reads.push({ select: value }); return this; },
    eq(key, value) { reads.push({ eq: [key, value] }); return this; },
    maybeSingle: async () => ({ data: row, error, status }),
  };
  const { liveData } = load('lib/data/live.ts', {
    '@/lib/config': { SITE_URL: 'https://mock.invalid' },
    '@/lib/album-edit-release': { albumEditReleaseEnabled: true },
    '@/lib/photo-retry-release': { photoRetryReleaseEnabled: false, isPhotoRetryAvailable: () => false },
    '@/lib/preset-release': { presetReleaseEnabled: false, isPresetPickingAvailable: () => false },
    '@/lib/photo-delete-release': { photoDeleteReleaseEnabled: false, isPhotoDeleteAvailable: () => false },
    '@/lib/photo-reprocess-release': { photoReprocessReleaseEnabled: false, isPhotoReprocessAvailable: () => false },
    '@/lib/photo-retry': { MAX_PHOTO_RETRIES_PER_TAP: 50, retryablePhotos: () => [], async retryPhotos() { throw Error('Closed retry gate must not send'); } },
    '@/lib/album-access-release': { albumAccessReleaseEnabled: false },
    '@/lib/supabase': { supabase: {
      auth: { getSession: async () => ({ data: { session: owner ? { user: { id: owner } } : null }, error: null }) },
      from(name) { reads.push({ from: name }); return query; },
    } },
    './types': types,
  });
  return { liveData, reads };
}

test('usage SELECT is pinned to the expected session owner and never mutates quota or queries subscriptions', async () => {
  const h = dataHarness();
  assert.deepEqual(plain(await h.liveData.fetchStorageUsage('owner-a')), usage());
  assert.deepEqual(h.reads, [
    { from: 'user_storage_usage' },
    { select: 'current_plan, storage_used_bytes, used_bytes, storage_limit_bytes' },
    { eq: ['user_id', 'owner-a'] },
  ]);
});

test('a stale account screen cannot even start SELECT under a different current SDK owner', async () => {
  for (const owner of ['owner-b', null]) {
    const h = dataHarness({ owner });
    await assert.rejects(h.liveData.fetchStorageUsage('owner-a'), { kind: 'unauthenticated' });
    assert.deepEqual(h.reads, []);
  }
});

test('an authoritative quota-query 401 is a session error, not a fabricated empty quota or cached-success response', async () => {
  const h = dataHarness({ row: null, status: 401, error: { message: 'private-auth-fixture' } });
  await assert.rejects(h.liveData.fetchStorageUsage('owner-a'), { kind: 'unauthenticated' });
});

test('missing/invalid storage rows fail closed; zero usage and absent capacity remain distinct', async () => {
  await assert.rejects(dataHarness({ row: null }).liveData.fetchStorageUsage('owner-a'), { kind: 'not-found' });
  for (const bad of [null, -1, Infinity, NaN, '', ' ', false, [], 'Infinity', 'private-fixture']) {
    const h = dataHarness({ row: { current_plan: 'free', used_bytes: bad, storage_limit_bytes: 100 } });
    await assert.rejects(h.liveData.fetchStorageUsage('owner-a'), { kind: 'server' });
  }
  const zero = dataHarness({ row: { current_plan: 'free', storage_used_bytes: 0, used_bytes: 5, storage_limit_bytes: null } });
  assert.deepEqual(plain(await zero.liveData.fetchStorageUsage('owner-a')), { plan: 'free', usedBytes: 0, limitBytes: 0 });
});

test('legacy used_bytes fallback stays readable and malformed plan/limit never becomes an invented Free badge', async () => {
  const valid = dataHarness({ row: { current_plan: 'pro', storage_used_bytes: null, used_bytes: '60', storage_limit_bytes: 100 } });
  assert.equal((await valid.liveData.fetchStorageUsage('owner-a')).usedBytes, 60);
  for (const bad of [{ current_plan: null, used_bytes: 0, storage_limit_bytes: 100 },
    { current_plan: 'free', used_bytes: 0, storage_limit_bytes: -1 }]) {
    await assert.rejects(dataHarness({ row: bad }).liveData.fetchStorageUsage('owner-a'), { kind: 'server' });
  }
});

function hookHarness({ demo = false } = {}) {
  const base = harness(), listeners = new Set(), queuedListeners = [], reads = [], slots = [];
  let owner = 'owner-a', focused = true, cursor = 0, pendingLayout = [], pendingEffects = [], pendingFocus = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (fn, deps) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() };
    return slots[i].value;
  };
  const effect = (fn, deps, pending) => {
    const i = cursor++, old = slots[i];
    if (old && same(old.deps, deps)) return;
    pending.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
  };
  const { useAccountUsage } = load('hooks/use-account-usage.ts', {
    react: { useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
      useLayoutEffect: (fn, deps) => effect(fn, deps, pendingLayout),
      useEffect: (fn, deps) => effect(fn, deps, pendingEffects),
      useSyncExternalStore: (_subscribe, get) => get() },
    'expo-router': { useFocusEffect: fn => effect(() => focused ? fn() : undefined, [fn, focused], pendingFocus) },
    '@/lib/account-usage': base.lib,
    '@/lib/config': { isDemoMode: demo },
    '@/lib/data': { data: { fetchStorageUsage: async id => { reads.push(id); return usage(); } } },
    '@/lib/supabase': { supabase: { auth: { onAuthStateChange(callback) {
      listeners.add(callback); queuedListeners.push(callback);
      return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } };
    } } } },
  });
  return { reads, listeners, timers: base.timers,
    render() {
      cursor = 0; pendingLayout = []; pendingEffects = []; pendingFocus = [];
      const state = useAccountUsage(owner);
      for (const queue of [pendingLayout, pendingEffects, pendingFocus]) while (queue.length) queue.shift()();
      return state;
    },
    emit(id) { for (const listener of [...listeners]) listener('AUTH_EVENT', id ? { user: { id } } : null); },
    focus(value) { focused = value; },
    owner(id) { owner = id; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    queuedAfterUnmount(id) { for (const listener of queuedListeners) listener('AUTH_EVENT', { user: { id } }); },
  };
}

test('the actual usage hook merges initial focus/effect reads and starts no SDK read inside an auth callback', async () => {
  const h = hookHarness(); h.render(); await settle();
  assert.deepEqual(h.reads, ['owner-a']);
  h.emit(null); h.emit('owner-a');
  assert.equal(h.reads.length, 1, 'Auth callback only clears/fences state');
  assert.equal(h.render().data, null);
  await settle(); assert.deepEqual(h.reads, ['owner-a', 'owner-a']);
  assert.equal(h.render().data.usedBytes, 40);
});

test('actual hook focus/account changes use a fresh query and cleanup blocks queued SDK events', async () => {
  const h = hookHarness(); h.render(); await settle();
  h.focus(false); h.render(); h.focus(true); h.render(); await settle();
  assert.equal(h.reads.length, 2);
  h.owner('owner-b'); assert.equal(h.render().data, null); await settle();
  assert.deepEqual(h.reads, ['owner-a', 'owner-a', 'owner-b']);
  h.unmount(); assert.equal(h.listeners.size, 0); h.queuedAfterUnmount('owner-a'); await settle();
  assert.equal(h.reads.length, 3); assert.equal(h.timers.size, 0);
});

test('demo usage hook never subscribes to real auth, and same-owner token events do not create another read', async () => {
  const demo = hookHarness({ demo: true }); demo.render(); await settle();
  assert.equal(demo.listeners.size, 0); assert.equal(demo.reads.length, 1);
  const live = hookHarness(); live.render(); await settle(); live.emit('owner-a'); live.render(); await settle();
  assert.equal(live.reads.length, 1);
  demo.unmount(); live.unmount();
});
