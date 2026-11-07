/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('../node_modules/typescript');

const root = path.resolve(__dirname, '../..');
const ownerId = '99999999-9999-4999-8999-999999999999';
const albumId = '22222222-2222-4222-8222-222222222222';
const timestamp = '2026-10-08T10:00:00.123456+00:00';

// Transpile only our modules and explicitly mock all database/delivery/auth
// boundaries. These tests never read environment files or contact production.
function loadTs(relative, mocks = {}, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    const resolved = specifier.startsWith('@/')
      ? path.resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : null;
    if (!resolved) throw new Error(`Unmocked external dependency: ${specifier}`);
    return loadTs(path.relative(root, `${resolved}.ts`), mocks, cache);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

function photo(number, createdAt = timestamp) {
  return {
    id: `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`,
    owner_id: ownerId, album_id: albumId, created_at: createdAt,
    filename: `${number}.jpg`, file_name: null,
    preview_url: `https://images.invalid/${number}.jpg`,
    thumbnail_url: `https://images.invalid/${number}-small.jpg`,
    processing_status: 'done', width: 1200, height: 800,
  };
}

// Independent of the production comparator: preserve PostgreSQL microseconds.
function micros(value) {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] || '';
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3, 6));
}

function compare(field, a, b) {
  const left = field === 'created_at' ? micros(a) : String(a);
  const right = field === 'created_at' ? micros(b) : String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function split(expression) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === '(') depth++;
    if (expression[i] === ')') depth--;
    if (expression[i] === ',' && depth === 0) { parts.push(expression.slice(start, i)); start = i + 1; }
  }
  parts.push(expression.slice(start));
  return parts;
}

function matches(row, expression) {
  if (expression.startsWith('and(')) return split(expression.slice(4, -1)).every((part) => matches(row, part));
  const match = /^([a-z_]+)\.(eq|lt|lte)\.(.+)$/.exec(expression);
  assert.ok(match, `Unsupported fixture expression: ${expression}`);
  const [, field, operation, value] = match;
  const result = compare(field, row[field], value);
  return operation === 'eq' ? result === 0 : operation === 'lt' ? result < 0 : result <= 0;
}

function database(rows, { ownAlbum = true, failPhotos = false } = {}) {
  const operations = [];
  const client = { from(table) {
    const filters = [], orders = [];
    let limit = Infinity;
    const execute = (single = false) => {
      if (table === 'photos' && failPhotos) return { data: null, error: { message: 'isolated failure' } };
      const source = table === 'photos' ? rows : ownAlbum ? [{ id: albumId, owner_id: ownerId }] : [];
      let result = source.filter((row) => filters.every((filter) => filter(row)));
      result = [...result].sort((a, b) => {
        for (const [field, ascending] of orders) {
          const compared = compare(field, a[field], b[field]);
          if (compared) return ascending ? compared : -compared;
        }
        return 0;
      }).slice(0, limit);
      return { data: single ? result[0] || null : result, error: null };
    };
    const query = {
      select(columns) { operations.push([table, 'select', columns]); return query; },
      eq(field, value) { filters.push((row) => row[field] === value); return query; },
      in(field, values) { filters.push((row) => values.includes(row[field])); return query; },
      order(field, { ascending }) { orders.push([field, ascending]); return query; },
      limit(value) { assert.ok(Number.isSafeInteger(value) && value > 0); limit = value; return query; },
      or(expression) { operations.push([table, 'or', expression]); filters.push((row) => split(expression).some((part) => matches(row, part))); return query; },
      lte(field, value) { filters.push((row) => compare(field, row[field], value) <= 0); return query; },
      async maybeSingle() { return execute(true); },
      then(resolve, reject) { return Promise.resolve().then(() => execute()).then(resolve, reject); },
    };
    return query;
  } };
  return { client, operations };
}

const deliveryMocks = {
  '../storage/album-covers': { resolveAlbumCoverDeliveries: async (_client, albums) => albums },
  '../storage/delivery': { resolvePhotoDeliveries: (rows) => rows },
};
const { listOwnerPhotos } = loadTs('src/lib/mobile/owner-data.ts', deliveryMocks);
const { PhotoFeed, mergeLatestPhotoPage, appendPhotoPage, updateLoadedPhotos } = loadTs('mobile/src/lib/data/photo-feed.ts');
const { photoProcessing } = loadTs('mobile/src/lib/data/types.ts');

test('processing progress is bounded, unavailable legacy state stays unknown and 100 percent alone is not ready', () => {
  const value = { ...mobilePhoto(1, false), processingStatus: 'processing' };
  for (const invalid of [undefined, null, '20', -1, 101, Infinity, NaN]) {
    assert.equal(photoProcessing({ ...value, processingProgress: invalid }).progress, null);
  }
  assert.equal(photoProcessing({ ...value, processingProgress: 34.5 }).progress, 35);
  assert.equal(photoProcessing({ ...value, processingProgress: 100 }).status, 'processing');
  assert.equal(photoProcessing(mobilePhoto(1, false)).status, 'unknown');
  assert.equal(photoProcessing({ ...value, processingStatus: 'done' }).status, 'preparing');
});

test('known failed/cancelled rows are excluded from automatic polling; read failures keep cached rows with explicit stale state', async () => {
  let reject = true;
  const calls = [];
  const rows = [{ ...mobilePhoto(1, false), processingStatus: 'failed' },
    { ...mobilePhoto(2, false), processingStatus: 'cancelled' },
    { ...mobilePhoto(3, false), processingStatus: 'pending' }, mobilePhoto(4, false)];
  const feed = new PhotoFeed({ fetchPage: async () => ({ photos: rows, nextCursor: 'older' }),
    fetchUpdates: async ids => { calls.push(ids); if (reject) throw Error('private diagnostic');
      return [{ ...rows[2], processingStatus: 'processing', processingProgress: 42 }]; } });
  await feed.reload();
  await feed.refreshProcessing();
  assert.deepEqual(calls, [['3', '4']]);
  assert.equal(feed.getSnapshot().processingError, true);
  assert.equal(feed.getSnapshot().photos.length, 4);
  assert.equal(feed.getSnapshot().nextCursor, 'older');
  reject = false;
  await feed.refreshProcessing();
  assert.equal(feed.getSnapshot().processingError, false);
  assert.equal(feed.getSnapshot().photos[2].processingProgress, 42);
  assert.equal(feed.getSnapshot().nextCursor, 'older');
});

function mobilePhoto(number, ready = true) {
  return {
    id: String(number), filename: `${number}.jpg`, createdAt: String(number),
    thumbnailUrl: ready ? `https://images.invalid/${number}.jpg` : null,
    previewUrl: null, blurDataUrl: null, width: null, height: null, isReady: ready,
  };
}

function fakeSource(initial) {
  const source = { rows: [...initial], calls: [], async fetchPage(cursor) {
    source.calls.push(cursor ?? null);
    const start = cursor ? source.rows.findIndex((photo) => photo.id === cursor) + 1 : 0;
    const photos = source.rows.slice(start, start + 60);
    return { photos, nextCursor: start + 60 < source.rows.length ? photos.at(-1).id : null };
  }, async fetchUpdates(ids) { return source.rows.filter((photo) => ids.includes(photo.id)); } };
  return source;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('tuple cursor reads 61 simultaneous uploads, once each, without leaking owner/album rows', async () => {
  const rows = Array.from({ length: 61 }, (_, i) => photo(i + 1));
  rows.push({ ...photo(900), owner_id: 'other-owner' }, { ...photo(901), album_id: 'other-album' });
  const { client, operations } = database(rows);
  const first = await listOwnerPhotos(client, ownerId, albumId);
  assert.equal(first.photos.length, 60);
  assert.deepEqual(JSON.parse(first.nextCursor), { createdAt: timestamp, id: photo(2).id });
  const second = await listOwnerPhotos(client, ownerId, albumId, { cursor: first.nextCursor });
  assert.deepEqual(second.photos.map((row) => row.id), [photo(1).id]);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.photos, ...second.photos].map((row) => row.id)).size, 61);
  assert.ok(operations.some(([, operation]) => operation === 'or'));
  assert.ok(operations.every(([, , columns]) => columns !== '*'));
});

test('timestamp microseconds and timezone offsets survive pagination without Date rounding', async () => {
  const rows = [photo(1, '2026-10-08T17:00:00.123456+07:00'), photo(2, '2026-10-08T10:00:00.123455Z'), photo(3, '2026-10-08T10:00:00.123454Z')];
  const { client } = database(rows);
  let cursor, ids = [];
  do {
    const page = await listOwnerPhotos(client, ownerId, albumId, { cursor, limit: 1 });
    ids.push(...page.photos.map((photo) => photo.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, rows.map((photo) => photo.id));
});

test('legacy timestamp boundary replays ties safely and advances to a tuple', async () => {
  const { client } = database(Array.from({ length: 61 }, (_, i) => photo(i + 1)));
  const replay = await listOwnerPhotos(client, ownerId, albumId, { cursor: timestamp });
  assert.equal(replay.photos.length, 60);
  const next = await listOwnerPhotos(client, ownerId, albumId, { cursor: replay.nextCursor });
  assert.deepEqual(next.photos.map((photo) => photo.id), [photo(1).id]);
});

test('targeted processing updates are bounded and scoped by both album and owner', async () => {
  const rows = [photo(1), photo(2), { ...photo(3), owner_id: 'other-owner' }, { ...photo(4), album_id: 'other-album' }];
  const { client } = database(rows);
  const page = await listOwnerPhotos(client, ownerId, albumId, { photoIds: rows.map((photo) => photo.id) });
  assert.deepEqual(page.photos.map((photo) => photo.id), [photo(2).id, photo(1).id]);
  assert.equal(page.nextCursor, null);
  await assert.rejects(listOwnerPhotos(client, ownerId, albumId, { photoIds: Array(121).fill(photo(1).id) }), /Invalid photo IDs/);
  assert.equal(await listOwnerPhotos(database(rows, { ownAlbum: false }).client, ownerId, albumId), null);
});

test('mobile photos route rejects malformed/injected cursors and ID batches before queries', async () => {
  const { client, operations } = database([photo(1)]);
  const nextMocks = {
    ...deliveryMocks,
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    '@/lib/mobile/server-client': { createMobileSupabaseClient: async () => ({ ...client, auth: { getUser: async () => ({ data: { user: { id: ownerId } } }) } }) },
  };
  const { GET } = loadTs('src/app/api/mobile/albums/[id]/photos/route.ts', nextMocks);
  const request = (params) => GET({ nextUrl: new URL(`https://ciiya.invalid/photos?${new URLSearchParams(params)}`) }, { params: Promise.resolve({ id: albumId }) });
  for (const cursor of ['', 'yesterday', JSON.stringify({ createdAt: timestamp, id: 'x),owner_id.eq.other' }), JSON.stringify({ createdAt: `${timestamp},owner_id.eq.other`, id: photo(1).id }), 'x'.repeat(257)]) {
    assert.equal((await request({ cursor })).status, 400);
  }
  for (const ids of ['', 'bad-id', Array(121).fill(photo(1).id).join(',')]) {
    assert.equal((await request({ ids })).status, 400);
  }
  assert.equal((await request({ ids: photo(1).id, cursor: timestamp })).status, 400);
  assert.equal(operations.length, 0);
  const valid = await request({ cursor: JSON.stringify({ createdAt: timestamp, id: photo(2).id }) });
  assert.equal(valid.status, 200);
  assert.match(valid.headers.get('Cache-Control'), /private, no-store/);
  assert.deepEqual((await valid.json()).photos.map((row) => row.id), [photo(1).id]);
});

test('70 new uploads have a contiguous pagination boundary; all appear after scrolling', async () => {
  const source = fakeSource(Array.from({ length: 121 }, (_, i) => mobilePhoto(121 - i)));
  const feed = new PhotoFeed(source);
  await feed.reload();
  await feed.loadMore();
  assert.equal(feed.getSnapshot().photos.length, 120);
  source.rows.unshift(...Array.from({ length: 70 }, (_, i) => mobilePhoto(191 - i)));
  await feed.refreshLatest();
  assert.equal(feed.getSnapshot().photos.length, 60, 'A disjoint head must not retain an unknown gap');
  assert.equal(feed.getSnapshot().nextCursor, '132');
  while (feed.getSnapshot().nextCursor) await feed.loadMore();
  assert.deepEqual(feed.getSnapshot().photos.map((row) => row.id), source.rows.map((row) => row.id));
  assert.equal(new Set(feed.getSnapshot().photos.map((row) => row.id)).size, 191);
});

test('overlapping latest page retains already loaded older pages and their cursor', () => {
  const previous = { photos: [mobilePhoto(5), mobilePhoto(4), mobilePhoto(3), mobilePhoto(2)], nextCursor: 'older' };
  const merged = mergeLatestPhotoPage(previous, { photos: [mobilePhoto(6), mobilePhoto(5, false), mobilePhoto(4)], nextCursor: '4' });
  assert.deepEqual(merged.photos.map((row) => row.id), ['6', '5', '4', '3', '2']);
  assert.equal(merged.photos[1].isReady, false);
  assert.equal(merged.nextCursor, 'older');
  const appended = appendPhotoPage(merged, { photos: [mobilePhoto(2, false), mobilePhoto(1)], nextCursor: null });
  assert.equal(appended.photos.length, 6);
  assert.equal(appended.photos.find((row) => row.id === '2').isReady, false);
});

test('stale load-more cannot overwrite a newer refresh cursor, and double scroll is coalesced', async () => {
  const nextPage = deferred();
  let pageCalls = 0;
  const feed = new PhotoFeed({
    async fetchPage(cursor) {
      if (cursor) { pageCalls++; return nextPage.promise; }
      return { photos: [mobilePhoto(10)], nextCursor: '10' };
    }, async fetchUpdates() { return []; },
  });
  await feed.reload();
  const loading = feed.loadMore();
  await feed.loadMore();
  assert.equal(pageCalls, 1);
  await feed.refreshLatest();
  nextPage.resolve({ photos: [mobilePhoto(9)], nextCursor: '9' });
  await loading;
  assert.equal(feed.getSnapshot().nextCursor, '10');
  assert.deepEqual(feed.getSnapshot().photos.map((row) => row.id), ['10']);
  assert.equal(feed.getSnapshot().loadingMore, false);
});

test('latest refresh wins out-of-order responses; disposed album never receives old data', async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const feed = new PhotoFeed({ fetchPage: () => (++calls === 1 ? first.promise : second.promise), async fetchUpdates() { return []; } });
  const one = feed.reload();
  const two = feed.refreshLatest();
  second.resolve({ photos: [mobilePhoto(20)], nextCursor: '20' });
  await two;
  first.resolve({ photos: [mobilePhoto(10)], nextCursor: '10' });
  await one;
  assert.equal(feed.getSnapshot().nextCursor, '20');
  const late = deferred();
  const disposed = new PhotoFeed({ fetchPage: () => late.promise, async fetchUpdates() { return []; } });
  const loading = disposed.reload();
  disposed.dispose();
  late.resolve({ photos: [mobilePhoto(99)], nextCursor: null });
  await loading;
  assert.equal(disposed.getSnapshot().photos.length, 0);
});

test('processing polling reaches older loaded photos in rotating batches, without advancing pagination', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => mobilePhoto(250 - i, false));
  const source = fakeSource(rows);
  const requested = [];
  source.fetchUpdates = async (ids) => { requested.push(ids); return []; };
  const feed = new PhotoFeed(source);
  await feed.reload();
  while (feed.getSnapshot().nextCursor) await feed.loadMore();
  await feed.refreshProcessing();
  await feed.refreshProcessing();
  await feed.refreshProcessing();
  assert.ok(requested.every((ids) => ids.length <= 120));
  assert.equal(new Set(requested.flat()).size, 250);
  assert.equal(feed.getSnapshot().nextCursor, null);
  const updated = updateLoadedPhotos(feed.getSnapshot(), [mobilePhoto(1), mobilePhoto(999)]);
  assert.equal(updated.photos.length, 250);
  assert.equal(updated.photos.at(-1).isReady, true);
  assert.equal(updated.nextCursor, null);
});

test('processing requests do not overlap and late polling cannot replace refreshed photos', async () => {
  const updates = deferred();
  let pollCalls = 0, ready = false;
  const feed = new PhotoFeed({
    async fetchPage() { return { photos: [mobilePhoto(1, ready)], nextCursor: 'older' }; },
    fetchUpdates() { pollCalls++; return updates.promise; },
  });
  await feed.reload();
  const poll = feed.refreshProcessing();
  await feed.refreshProcessing();
  assert.equal(pollCalls, 1);
  ready = true;
  await feed.refreshLatest();
  updates.resolve([mobilePhoto(1, false)]);
  await poll;
  assert.equal(feed.getSnapshot().photos[0].isReady, true);
  assert.equal(feed.getSnapshot().nextCursor, 'older');
});

test('failed load-more preserves its cursor for retry and StrictMode cleanup/replay is safe', async () => {
  let failed = false;
  const feed = new PhotoFeed({
    async fetchPage(cursor) {
      if (!cursor) return { photos: [mobilePhoto(2)], nextCursor: '2' };
      if (!failed) { failed = true; throw new Error('offline'); }
      return { photos: [mobilePhoto(1)], nextCursor: null };
    }, async fetchUpdates() { return []; },
  });
  await feed.reload();
  await feed.loadMore();
  assert.equal(feed.getSnapshot().nextCursor, '2');
  assert.equal(feed.getSnapshot().status, 'ready');
  assert.equal(feed.getSnapshot().error.message, 'offline');
  assert.equal(feed.getSnapshot().errorSource, 'more');
  assert.deepEqual(feed.getSnapshot().photos.map((photo) => photo.id), ['2']);
  assert.equal(feed.getSnapshot().loadingMore, false);
  await feed.loadMore();
  assert.equal(feed.getSnapshot().photos.length, 2);
  assert.equal(feed.getSnapshot().error, null);
  assert.equal(feed.getSnapshot().errorSource, null);
  feed.dispose();
  await feed.reload();
  assert.equal(feed.getSnapshot().nextCursor, '2');
});

test('failed latest refresh keeps cached photos and cursor with a visible retryable error', async () => {
  let failLatest = false;
  const feed = new PhotoFeed({
    async fetchPage(cursor) {
      if (cursor) return { photos: [mobilePhoto(1)], nextCursor: null };
      if (failLatest) throw new Error('refresh offline');
      return { photos: [mobilePhoto(2)], nextCursor: '2' };
    }, async fetchUpdates() { return []; },
  });
  await feed.reload();
  failLatest = true;
  await feed.refreshLatest(true);
  assert.equal(feed.getSnapshot().status, 'ready');
  assert.equal(feed.getSnapshot().refreshing, false);
  assert.equal(feed.getSnapshot().errorSource, 'latest');
  assert.equal(feed.getSnapshot().error.message, 'refresh offline');
  assert.equal(feed.getSnapshot().nextCursor, '2');
  assert.deepEqual(feed.getSnapshot().photos.map((photo) => photo.id), ['2']);
  await feed.loadMore();
  assert.equal(feed.getSnapshot().errorSource, 'latest', 'An older page cannot resolve a failed latest refresh');
  assert.equal(feed.getSnapshot().photos.length, 2);
  failLatest = false;
  await feed.refreshLatest(true);
  assert.equal(feed.getSnapshot().error, null);
  assert.equal(feed.getSnapshot().errorSource, null);
  assert.equal(feed.getSnapshot().photos.length, 2);
});

test('late pagination failure cannot add an error to a newer successful refresh', async () => {
  const oldMore = deferred();
  const feed = new PhotoFeed({
    async fetchPage(cursor) {
      if (cursor) return oldMore.promise;
      return { photos: [mobilePhoto(2)], nextCursor: '2' };
    }, async fetchUpdates() { return []; },
  });
  await feed.reload();
  const more = feed.loadMore();
  await feed.refreshLatest();
  oldMore.reject(new Error('stale offline'));
  await more;
  assert.equal(feed.getSnapshot().status, 'ready');
  assert.equal(feed.getSnapshot().error, null);
  assert.equal(feed.getSnapshot().errorSource, null);
  assert.equal(feed.getSnapshot().nextCursor, '2');
});
