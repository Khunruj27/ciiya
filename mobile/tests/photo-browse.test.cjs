/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/data/photo-browse.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const lib = {};
vm.runInNewContext(code, { exports: lib });
const photo = (id, filename = `Photo ${id}.jpg`, isReady = true) => ({ id, filename, isReady,
  previewUrl: null, thumbnailUrl: null, blurDataUrl: null, width: null, height: null, createdAt: '2026-10-14' });
const ids = photos => Array.from(photos, value => value.id);

test('local filename search supports Thai/English, equivalent Unicode, case and all whitespace-separated words', () => {
  const rows = [photo('a', 'Air เขาใหญ่ 001.JPG'), photo('b', 'Pleum 002.jpg'), photo('c', null)];
  for (const query of [' AIR  เขาใหญ่ ', 'ＡＩＲ\n001', '.JPG เขาใหญ่']) {
    assert.deepEqual(ids(lib.selectPhotos(rows, query, 'all')), ['a']);
  }
  assert.deepEqual(ids(lib.selectPhotos(rows, 'pleum', 'all')), ['b']);
  assert.deepEqual(ids(lib.selectPhotos([photo('tone', 'ป่า.jpg')], 'ปา', 'all')), []);
});

test('only filenames are searchable, never public/signed URL components or opaque photo IDs', () => {
  const value = { ...photo('private-id', null), previewUrl: 'https://mock.invalid/private-query-value' };
  assert.deepEqual(ids(lib.selectPhotos([value], 'private', 'all')), []);
  assert.deepEqual(ids(lib.selectPhotos([value], '', 'all')), ['private-id']);
});

test('readiness filtering uses a true flag only and never diagnoses not-ready photos as failed jobs', () => {
  const rows = [photo('ready'), photo('pending', 'Pending.jpg', false), photo('unknown', null, undefined)];
  rows[2].isReady = undefined;
  assert.deepEqual(ids(lib.selectPhotos(rows, '', 'ready')), ['ready']);
  assert.deepEqual(ids(lib.selectPhotos(rows, '', 'not-ready')), ['pending', 'unknown']);
  const counts = lib.loadedPhotoReadiness(rows);
  assert.equal(counts.ready, 1); assert.equal(counts.notReady, 2); assert.equal(counts.loaded, 3);
});

test('failed filter and loaded counts use explicit statuses without classifying legacy unknown rows as failures', () => {
  const rows = [photo('ready'), { ...photo('pending', null, false), processingStatus: 'pending' },
    { ...photo('working', null, false), processingStatus: 'processing' },
    { ...photo('failed', null, false), processingStatus: 'failed' },
    { ...photo('stopped', null, false), processingStatus: 'cancelled' },
    { ...photo('preview', null, false), processingStatus: 'done' }, photo('legacy', null, false)];
  assert.deepEqual(ids(lib.selectPhotos(rows, '', 'failed')), ['failed']);
  assert.deepEqual(JSON.parse(JSON.stringify(lib.loadedProcessingCounts(rows))),
    { waiting: 1, working: 1, failed: 1, stopped: 1, preparing: 1, unknown: 1 });
  assert.equal(lib.isPhotoBrowseFiltered('', 'failed'), true);
  assert.deepEqual(ids(lib.selectPhotos(rows, 'no-match', 'failed')), []);
});

test('filters and search combine without sorting or mutating the cached page objects', () => {
  const rows = Object.freeze([Object.freeze(photo('z', 'Wedding 2.jpg')),
    Object.freeze(photo('a', 'Wedding 1.jpg')), Object.freeze(photo('b', 'Wedding 3.jpg', false))]);
  assert.deepEqual(ids(lib.selectPhotos(rows, 'wedding', 'ready')), ['z', 'a']);
  assert.deepEqual(ids(lib.selectPhotos(rows, 'wedding', 'not-ready')), ['b']);
  assert.deepEqual(ids(rows), ['z', 'a', 'b']);
});

test('blank/whitespace searches retain normal paging while any real query/status restriction is filtered', () => {
  assert.equal(lib.isPhotoBrowseFiltered(' \n ', 'all'), false);
  assert.equal(lib.isPhotoBrowseFiltered('001', 'all'), true);
  assert.equal(lib.isPhotoBrowseFiltered('', 'ready'), true);
  assert.equal(lib.isPhotoBrowseFiltered('', 'not-ready'), true);
  assert.deepEqual(ids(lib.selectPhotos([], '', 'all')), []);
});

test('filtered pager freezes IDs/order but consumes current preview/readiness objects without re-running the filter', () => {
  const old = [photo('a', 'A.jpg', false), photo('b', 'B.jpg', false)];
  const frozen = lib.selectPhotos(old, '', 'not-ready').map(value => value.id);
  const readyA = { ...photo('a', 'A.jpg'), previewUrl: 'https://mock.invalid/current' };
  const latest = [photo('new', 'New.jpg', false), photo('b', 'B.jpg', false), readyA];
  assert.deepEqual(ids(lib.frozenPhotoSelection(frozen, latest)), ['a', 'b']);
  assert.equal(lib.frozenPhotoSelection(frozen, latest)[0], readyA);
  assert.deepEqual(ids(lib.selectPhotos(latest, '', 'not-ready')), ['new', 'b']);
});

test('missing or duplicated frozen IDs fail closed instead of shifting a numeric swipe position', () => {
  const rows = [photo('a'), photo('b')];
  for (const selected of [[], ['a', 'missing'], ['a', 'a']]) {
    assert.deepEqual(ids(lib.frozenPhotoSelection(selected, rows)), []);
  }
});
