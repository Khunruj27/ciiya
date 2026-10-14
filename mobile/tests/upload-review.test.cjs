/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}
const review = load('lib/uploads/review.ts');
const summary = load('hooks/use-uploads.ts', {
  react: { useSyncExternalStore: (_subscribe, read) => read() },
  '@/lib/uploads/queue': { getUploads: () => [], subscribeToUploads() {} },
  '@/lib/uploads/review': review,
});
const plain = value => JSON.parse(JSON.stringify(value));
function item(overrides = {}) {
  return {
    id: 'upload-a', ownerId: 'owner-a', albumId: 'album-a', fileName: 'photo.jpg',
    mimeType: 'image/jpeg', sizeBytes: 100, fileHash: 'hash', localName: 'copy.jpg',
    size: 'hd', autoFaceScan: false, autoPublish: false, status: 'queued',
    progress: 0, attempts: 0, failure: null, registering: false, staged: null,
    createdAt: 1, ...overrides,
  };
}
function actions(initial = [item()]) {
  let items = initial, epoch = 0, active = true;
  const renderedEpoch = epoch;
  const retries = [], removals = [], clears = [];
  const controller = review.createUploadReviewActions({
    albumId: 'album-a',
    capture: () => {
      if (!active || epoch !== renderedEpoch) return null;
      const captured = epoch;
      return () => active && epoch === captured;
    },
    getItems: () => items,
    retry: id => {
      retries.push(id);
      items = items.map(value => value.id === id ? { ...value, status: 'queued' } : value);
    },
    remove: id => { removals.push(id); items = items.filter(value => value.id !== id); },
    clearFinished: id => clears.push(id),
  });
  return {
    controller, retries, removals, clears,
    replace(next) { items = next; },
    leave() { active = false; epoch++; },
    return() { active = true; epoch++; },
  };
}

test('review partitions transfer and registration states without claiming processing is complete', () => {
  const statuses = ['queued', 'uploading', 'finishing', 'done', 'duplicate', 'failed'];
  const items = statuses.map((status, i) => item({ id: String(i), status }));
  items.push(item({ staged: { storagePath: 'never-disclosed', uncertain: true } }));
  assert.deepEqual(plain(review.reviewUploads(items)), {
    queued: 1, uploading: 1, finishing: 1, stored: 1, duplicates: 1, failed: 1, held: 1, retryable: 1,
  });
  assert.deepEqual(plain(review.reviewUploads([])), {
    queued: 0, uploading: 0, finishing: 0, stored: 0, duplicates: 0, failed: 0, held: 0, retryable: 0,
  });
});

test('legacy journals and missing files do not offer a retry; registration cannot be removed', () => {
  for (const status of ['queued', 'uploading', 'finishing', 'failed', 'done', 'duplicate']) {
    const held = item({ status, staged: { storagePath: 'repair', uncertain: false } });
    assert.equal(review.canRetryUpload(held), false);
    assert.equal(review.canRemoveUpload(held), false);
  }
  assert.equal(review.canRetryUpload(item({ status: 'failed', failure: 'file-missing' })), false);
  assert.equal(review.canRemoveUpload(item({ status: 'finishing' })), false);
  for (const status of ['queued', 'uploading', 'failed']) {
    assert.equal(review.canRemoveUpload(item({ status, registering: true })), false);
  }
  assert.equal(review.canRetryUpload(item({ status: 'failed', registering: true })), true);
});

test('restored invalid progress never escapes 0–100 or poisons the batch summary', () => {
  for (const [value, expected] of [[-1, 0], [2, 1], [NaN, 0], [Infinity, 0], [0.42, 0.42]]) {
    assert.equal(review.uploadProgress(value), expected);
    const result = summary.summarizeUploads([item({ progress: value })]);
    assert.equal(result.progress, expected);
  }
});

test('the banner includes held journals as attention, never as a running or retryable upload', () => {
  const result = summary.summarizeUploads([
    item({ staged: { storagePath: 'private-path', uncertain: true } }),
    item({ id: 'done', status: 'done' }),
    item({ id: 'failed', status: 'failed', failure: 'file-missing' }),
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.active, 0);
  assert.equal(result.finished, 1);
  assert.equal(result.failed, 2);
  assert.equal(result.retryable, 0);
  assert.equal(result.progress, 1);
});

test('building review actions performs no queue operation and a removal requires explicit confirmation', () => {
  const h = actions();
  assert.deepEqual(h.removals, []);
  const confirmation = h.controller.requestRemove('upload-a');
  assert.equal(confirmation.fileName, 'photo.jpg');
  assert.deepEqual(h.removals, []);
  confirmation.confirm();
  confirmation.confirm();
  confirmation.cancel();
  assert.deepEqual(h.removals, ['upload-a']);
});

test('cancelling a dialog never removes or retries and allows a new deliberate confirmation', () => {
  const h = actions();
  const confirmation = h.controller.requestRemove('upload-a');
  confirmation.cancel();
  confirmation.confirm();
  assert.deepEqual(h.removals, []);
  assert.deepEqual(h.retries, []);
  h.controller.requestRemove('upload-a').confirm();
  assert.deepEqual(h.removals, ['upload-a']);
});

test('a pending confirmation blocks another dialog and retry-all until it settles', () => {
  const h = actions([item({ status: 'failed' })]);
  const confirmation = h.controller.requestRemove('upload-a');
  assert.equal(h.controller.requestRemove('upload-a'), null);
  h.controller.retry();
  assert.deepEqual(h.retries, []);
  confirmation.cancel();
  h.controller.retry();
  h.controller.retry();
  assert.deepEqual(h.retries, ['upload-a']);
});

test('confirmation rechecks current status, registration, repair source and file identity', () => {
  for (const change of [
    { status: 'done' }, { status: 'duplicate' }, { status: 'finishing' },
    { registering: true }, { staged: { storagePath: 'repair', uncertain: true } },
    { ownerId: 'owner-b' }, { albumId: 'album-b' }, { localName: 'other.jpg' }, { fileHash: 'other' },
  ]) {
    const h = actions();
    const confirmation = h.controller.requestRemove('upload-a');
    h.replace([item(change)]);
    confirmation.confirm();
    assert.deepEqual(h.removals, [], JSON.stringify(change));
  }
  const h = actions();
  const confirmation = h.controller.requestRemove('upload-a');
  h.replace([]);
  confirmation.confirm();
  assert.deepEqual(h.removals, []);
});

test('the same photo moving from waiting to byte transfer can still be deliberately stopped', () => {
  const h = actions();
  const confirmation = h.controller.requestRemove('upload-a');
  h.replace([item({ status: 'uploading', progress: 0.5 })]);
  confirmation.confirm();
  assert.deepEqual(h.removals, ['upload-a']);
});

test('leaving and returning to the account/album/focus never revives an old dialog or rendered action', () => {
  const h = actions([item({ status: 'failed' })]);
  const confirmation = h.controller.requestRemove('upload-a');
  h.leave();
  h.return();
  confirmation.confirm();
  h.controller.retry();
  assert.equal(h.controller.requestRemove('upload-a'), null);
  h.controller.clearFinished();
  assert.deepEqual(h.removals, []);
  assert.deepEqual(h.retries, []);
  assert.deepEqual(h.clears, []);
});

test('retry-all uses only current eligible uploads in this album, not held, finished or foreign-album items', () => {
  const h = actions([
    item({ id: 'regular', status: 'failed' }),
    item({ id: 'held', status: 'failed', staged: { storagePath: 'repair', uncertain: true } }),
    item({ id: 'missing', status: 'failed', failure: 'file-missing' }),
    item({ id: 'done', status: 'done' }),
    item({ id: 'other', status: 'failed', albumId: 'album-b' }),
  ]);
  h.controller.retry();
  assert.deepEqual(h.retries, ['regular']);
});

test('a missing or malformed row ID never silently becomes a retry-all command', () => {
  const h = actions([item({ status: 'failed' })]);
  h.controller.retry('');
  h.controller.retry('missing');
  assert.deepEqual(h.retries, []);
});

test('clear removes only a finished-summary through the scoped port and is refused while active or held', () => {
  for (const other of [item(), item({ staged: { storagePath: 'repair', uncertain: true } })]) {
    const h = actions([item({ status: 'done' }), other]);
    h.controller.clearFinished();
    assert.deepEqual(h.clears, []);
  }
  const h = actions([item({ status: 'done' }), item({ id: 'failed', status: 'failed' })]);
  h.controller.clearFinished();
  assert.deepEqual(h.clears, ['album-a']);
  assert.deepEqual(h.removals, []);
});
