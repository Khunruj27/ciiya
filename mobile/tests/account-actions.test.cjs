/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/account-actions.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const lib = {};
vm.runInNewContext(source, { exports: lib });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(exit) {
  let epoch = 0, authorized = true, exits = 0;
  const busy = [], errors = [];
  const actions = lib.createAccountActions({
    capture: () => {
      if (!authorized) return null;
      const captured = epoch;
      return () => authorized && captured === epoch;
    },
    signOut: () => { exits++; return exit ? exit() : Promise.resolve(); },
    onBusy: value => busy.push(value), onError: () => errors.push('generic-local-error'),
  });
  return { actions, busy, errors, exits: () => exits,
    leaveAndReturn() { epoch += 2; }, deny() { authorized = false; } };
}

test('sign-out requires a human confirmation; constructing, opening and cancelling perform no auth action', async () => {
  const h = harness();
  const ticket = h.actions.requestSignOut();
  assert.equal(h.exits(), 0);
  ticket.cancel();
  await ticket.confirm();
  assert.equal(h.exits(), 0);
  assert.deepEqual(h.busy, []);
});

test('confirmation is single-flight before React commits, including duplicate confirms while sign-out is pending', async () => {
  const exit = deferred();
  const h = harness(() => exit.promise);
  const ticket = h.actions.requestSignOut();
  assert.equal(h.actions.requestSignOut(), null);
  const pending = ticket.confirm();
  await ticket.confirm();
  assert.equal(h.actions.requestSignOut(), null);
  assert.equal(h.exits(), 1);
  assert.deepEqual(h.busy, [true]);
  exit.resolve(); await pending;
  assert.deepEqual(h.busy, [true, false]);
});

test('old confirmations cannot sign out after the account/focus leaves and returns or becomes unauthorized', async () => {
  for (const invalidate of [h => h.leaveAndReturn(), h => h.deny(), h => h.actions.dispose()]) {
    const h = harness();
    const ticket = h.actions.requestSignOut();
    invalidate(h);
    await ticket.confirm();
    assert.equal(h.exits(), 0);
    assert.deepEqual(h.busy, []);
  }
});

test('sign-out errors are local generic UI outcomes, never an automatic second sign-out', async () => {
  const h = harness(() => Promise.reject(Error('private-auth-fixture')));
  await h.actions.requestSignOut().confirm();
  assert.equal(h.exits(), 1);
  assert.deepEqual(h.errors, ['generic-local-error']);
  assert.deepEqual(h.busy, [true, false]);
});

test('late success/failure cannot update a new account or an unmounted screen', async () => {
  for (const reject of [false, true]) {
    const exit = deferred();
    const h = harness(() => exit.promise);
    const pending = h.actions.requestSignOut().confirm();
    h.leaveAndReturn();
    if (reject) exit.reject(Error('old-private-fixture')); else exit.resolve();
    await pending;
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.busy, [true]);
  }
});

test('Strict Mode replay activates a new action lifetime without reviving a disposed ticket or unlocking another dialog', async () => {
  const h = harness();
  const old = h.actions.requestSignOut();
  h.actions.dispose(); h.actions.activate();
  const fresh = h.actions.requestSignOut();
  old.cancel();
  assert.equal(h.actions.requestSignOut(), null);
  await old.confirm();
  assert.equal(h.exits(), 0);
  await fresh.confirm();
  assert.equal(h.exits(), 1);
});
