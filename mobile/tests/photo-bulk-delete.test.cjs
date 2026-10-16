/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function transpile(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const types = {};
vm.runInNewContext(transpile('data/types.ts'), { exports: types, Error });
const runner = {};
vm.runInNewContext(transpile('photo-bulk-delete.ts'), {
  exports: runner, Promise, Error, Set,
  require(name) { assert.equal(name, '@/lib/data/types'); return types; },
});
const photo = (id, processingStatus, isReady = false) => ({ id, isReady, processingStatus, processingProgress: null });

test('photos the worker may still write are not deletable; finished, failed and unknown ones are', () => {
  const cases = [
    [photo('a', 'done', true), true], [photo('b', 'failed'), true], [photo('c', 'cancelled'), true],
    [photo('d', undefined), true], [photo('e', 'pending'), false], [photo('f', 'processing'), false],
    [photo('g', 'uploading'), false], [photo('h', 'finalizing'), false],
  ];
  for (const [value, expected] of cases) assert.equal(runner.isPhotoDeletable(value), expected, value.id);
});

test('deletion is sequential, deduplicated, capped at the batch limit and counts outcomes', async () => {
  let inFlight = 0, maxInFlight = 0;
  const sent = [];
  const ids = ['a', 'b', 'a', 'gone', ...Array.from({ length: 120 }, (_, i) => `x${i}`)];
  const progress = [];
  const summary = await runner.deletePhotos({
    photoIds: ids,
    isCurrent: () => true,
    onProgress: (done, total) => progress.push([done, total]),
    async remove(id) {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      sent.push(id);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return id === 'b' ? 'processing' : id === 'gone' ? 'gone' : 'deleted';
    },
  });
  assert.equal(maxInFlight, 1, 'Never more than one deletion at a time');
  assert.equal(sent.length, runner.MAX_PHOTO_DELETES_PER_BATCH);
  assert.equal(new Set(sent).size, sent.length);
  assert.equal(summary.processing, 1);
  assert.ok(summary.removed.includes('gone'), 'Already gone is removed from the grid too');
  assert.equal(summary.removed.length, runner.MAX_PHOTO_DELETES_PER_BATCH - 1);
  assert.deepEqual(progress.at(-1), [runner.MAX_PHOTO_DELETES_PER_BATCH, runner.MAX_PHOTO_DELETES_PER_BATCH]);
});

test('leaving the album or account stops before the next deletion', async () => {
  let current = true;
  const sent = [];
  const summary = await runner.deletePhotos({
    photoIds: ['a', 'b', 'c'], isCurrent: () => current,
    async remove(id) { sent.push(id); current = false; return 'deleted'; },
  });
  assert.deepEqual(sent, ['a']);
  assert.deepEqual([...summary.removed], ['a']);
  assert.equal(summary.skipped, 2);
  assert.equal(summary.stopped, true);
});

test('sign-out stops at once; three network failures stop; other errors continue and are not removed', async () => {
  const signedOut = await runner.deletePhotos({
    photoIds: ['a', 'b', 'c'], isCurrent: () => true,
    async remove() { throw new types.DataError('unauthenticated'); },
  });
  assert.deepEqual([signedOut.failed, signedOut.skipped, signedOut.stopped], [1, 2, true]);

  const offline = await runner.deletePhotos({
    photoIds: ['a', 'b', 'c', 'd', 'e'], isCurrent: () => true,
    async remove() { throw new types.DataError('network'); },
  });
  assert.deepEqual([offline.failed, offline.skipped, offline.stopped], [3, 2, true]);

  let calls = 0;
  const mixed = await runner.deletePhotos({
    photoIds: ['a', 'b', 'c'], isCurrent: () => true,
    async remove(id) { calls++; if (calls === 1) throw new types.DataError('server'); return 'deleted'; },
  });
  assert.equal(mixed.failed, 1);
  assert.deepEqual([...mixed.removed], ['b', 'c'], 'A failed request is never assumed deleted');
  assert.equal(mixed.stopped, false);
});

test('the album screen confirms destructively, fences repeats and re-checks the visit before deleting', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/(app)/(albums)/album/[id]/index.tsx'), 'utf8');
  assert.match(source, /deleteSelectedConfirm, style: 'destructive'/);
  assert.match(source, /async function runDeleteSelected[\s\S]*?if \(!isCurrent\(\) \|\| deletingRef\.current\) return;/);
  assert.match(source, /isPhotoDeleteAvailable\(\) \? \(/, 'Selection appears only when deletion is available');
});
