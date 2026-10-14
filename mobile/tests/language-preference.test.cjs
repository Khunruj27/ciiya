/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/language-preference.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject });
const { createLanguagePreferenceStore, resolveLocale, parseLanguagePreference } = exportsObject;
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test('device default follows supported language and a manual choice overrides it', () => {
  for (const invalid of [null, '', 'fr', {}, 'TH']) assert.equal(parseLanguagePreference(invalid), 'system');
  assert.equal(resolveLocale('system', 'th'), 'th');
  assert.equal(resolveLocale('system', 'fr'), 'en');
  assert.equal(resolveLocale('system', null), 'th');
  assert.equal(resolveLocale('en', 'th'), 'en');
  assert.equal(resolveLocale('th', 'en'), 'th');
});

test('restart restores the selected language without writing or touching an account', async () => {
  let stored = 'en', reads = 0;
  const writes = [];
  const ports = { read: async () => { reads++; return stored; }, write: async value => { writes.push(value); stored = value; } };
  const first = createLanguagePreferenceStore(ports);
  assert.deepEqual(writes, []);
  await first.restore(); await first.restore();
  assert.equal(reads, 1);
  assert.equal(first.getSnapshot().preference, 'en');
  await first.select('th');
  const restarted = createLanguagePreferenceStore(ports);
  await restarted.restore();
  assert.equal(restarted.getSnapshot().preference, 'th');
  assert.deepEqual(writes, ['th']);
});

test('slow startup hydration cannot replace a newer user choice', async () => {
  const old = deferred();
  const store = createLanguagePreferenceStore({ read: () => old.promise, write: async () => {} });
  const restore = store.restore();
  await store.select('th');
  old.resolve('en'); await restore;
  assert.equal(store.getSnapshot().preference, 'th');
  const selectedBeforeRestore = createLanguagePreferenceStore({ read: async () => 'en', write: async () => {} });
  await selectedBeforeRestore.select('th');
  await selectedBeforeRestore.restore();
  assert.equal(selectedBeforeRestore.getSnapshot().preference, 'th');
});

test('rapid choices are persisted in order and an older completion cannot reset newest pending state', async () => {
  const first = deferred(), persisted = [];
  const store = createLanguagePreferenceStore({ read: async () => null, write: async value => {
    persisted.push(value); if (persisted.length === 1) await first.promise;
  } });
  const a = store.select('th'), b = store.select('en'), c = store.select('system');
  await settle();
  assert.deepEqual(persisted, ['th']);
  assert.deepEqual(plain(store.getSnapshot()), { preference: 'system', saving: true, saveFailed: false });
  first.resolve(); await Promise.all([a, b, c]);
  assert.deepEqual(persisted, ['th', 'en', 'system']);
  assert.deepEqual(plain(store.getSnapshot()), { preference: 'system', saving: false, saveFailed: false });
});

test('failed local persistence keeps language usable and selecting it again deliberately retries', async () => {
  let attempts = 0;
  const store = createLanguagePreferenceStore({ read: async () => { throw Error('unavailable'); }, write: async () => {
    if (++attempts === 1) throw Error('unavailable');
  } });
  await store.restore();
  assert.equal(store.getSnapshot().preference, 'system');
  await store.select('en');
  assert.deepEqual(plain(store.getSnapshot()), { preference: 'en', saving: false, saveFailed: true });
  await store.select('en');
  assert.deepEqual(plain(store.getSnapshot()), { preference: 'en', saving: false, saveFailed: false });
});
