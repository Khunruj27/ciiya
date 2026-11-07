import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { NextRequest } from 'next/server'
import { getShareAuthCookieName, signShareAuthToken } from '../src/lib/share-access'

type Row = Record<string, unknown>
type QueryResult = { data: Row[] | Row | null; count: number | null; error: Error | null }
type Page = { photos: Row[]; hasMore: boolean; nextCursor: string | null }
type Fixture = {
  rows: Row[]
  album: Row | null
  allowed: boolean
  failPhotos: boolean
  queries: { table: string; operations: unknown[][] }[]
}

// Compare the database's full timestamp precision independently of the
// production cursor/comparator implementation, including timezone offsets.
function timestampMicros(value: unknown) {
  const text = String(value)
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(text)?.[1] || ''
  return BigInt(Date.parse(text)) * BigInt(1000) + BigInt(fraction.padEnd(6, '0').slice(3, 6))
}

function compare(field: string, left: unknown, right: unknown) {
  const a = field.endsWith('_at') ? timestampMicros(left) : String(left)
  const b = field.endsWith('_at') ? timestampMicros(right) : String(right)
  return a < b ? -1 : a > b ? 1 : 0
}

function splitExpressions(expression: string) {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < expression.length; index++) {
    if (expression[index] === '(') depth++
    if (expression[index] === ')') depth--
    if (expression[index] === ',' && depth === 0) {
      parts.push(expression.slice(start, index))
      start = index + 1
    }
  }
  parts.push(expression.slice(start))
  return parts
}

function matches(row: Row, expression: string): boolean {
  if (expression.startsWith('and(') && expression.endsWith(')')) {
    return splitExpressions(expression.slice(4, -1)).every((part) => matches(row, part))
  }
  if (expression.startsWith('or(') && expression.endsWith(')')) {
    return splitExpressions(expression.slice(3, -1)).some((part) => matches(row, part))
  }
  const match = /^([a-z_]+)\.(eq|lt|lte|gt|gte)\.(.+)$/.exec(expression)
  assert.ok(match, `Fixture does not understand database expression: ${expression}`)
  const [, field, operation, value] = match
  const compared = compare(field, row[field], value)
  return operation === 'eq' ? compared === 0
    : operation === 'lt' ? compared < 0
      : operation === 'lte' ? compared <= 0
        : operation === 'gt' ? compared > 0 : compared >= 0
}

function createQuery(fixture: Fixture, table: string) {
  const operations: unknown[][] = []
  fixture.queries.push({ table, operations })
  const filters: ((row: Row) => boolean)[] = []
  const ordering: { field: string; ascending: boolean }[] = []
  let maximum: number | null = null
  let head = false
  let counted = false
  const execute = (single = false): QueryResult => {
    if (table === 'photos' && fixture.failPhotos) {
      return { data: null, count: null, error: new Error('isolated fixture database failure') }
    }
    const source = table === 'photos' ? fixture.rows : fixture.album ? [fixture.album] : []
    let rows = source.filter((row) => filters.every((filter) => filter(row)))
    const count = counted ? rows.length : null
    rows = [...rows].sort((a, b) => {
      for (const order of ordering) {
        const result = compare(order.field, a[order.field], b[order.field])
        if (result) return order.ascending ? result : -result
      }
      return 0
    })
    if (maximum !== null) rows = rows.slice(0, maximum)
    return { data: head ? null : single ? rows[0] ?? null : rows, count, error: null }
  }
  const query = {
    select(columns: string, options?: { count?: string; head?: boolean }) {
      operations.push(['select', columns, options])
      counted = Boolean(options?.count)
      head = Boolean(options?.head)
      return query
    },
    eq(field: string, value: unknown) {
      operations.push(['eq', field, value])
      filters.push((row) => row[field] === value)
      return query
    },
    not(field: string, operation: string, value: unknown) {
      operations.push(['not', field, operation, value])
      assert.equal(operation, 'is')
      assert.equal(value, null)
      filters.push((row) => row[field] != null)
      return query
    },
    lt(field: string, value: unknown) {
      operations.push(['lt', field, value])
      filters.push((row) => compare(field, row[field], value) < 0)
      return query
    },
    lte(field: string, value: unknown) {
      operations.push(['lte', field, value])
      filters.push((row) => compare(field, row[field], value) <= 0)
      return query
    },
    or(expression: string) {
      operations.push(['or', expression])
      filters.push((row) => splitExpressions(expression).some((part) => matches(row, part)))
      return query
    },
    order(field: string, options: { ascending: boolean }) {
      operations.push(['order', field, options])
      ordering.push({ field, ascending: options.ascending })
      return query
    },
    limit(value: number) {
      operations.push(['limit', value])
      assert.ok(Number.isSafeInteger(value) && value > 0)
      maximum = value
      return query
    },
    async maybeSingle() { return execute(true) },
    then(resolve: (result: QueryResult) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => execute()).then(resolve, reject)
    },
  }
  return query
}

const albumId = '22222222-2222-4222-8222-222222222222'
const sharedTimestamp = '2026-10-01T10:00:00.123456+00:00'

function photo(number: number, createdAt = sharedTimestamp): Row {
  return {
    id: `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`,
    album_id: albumId,
    filename: `photo-${number}.jpg`,
    processing_status: 'done',
    created_at: createdAt,
    updated_at: '2026-10-01T11:00:00.000001+00:00',
    storage_provider: 'supabase',
    public_url: `https://images.test/${number}.jpg`,
    preview_url: `https://images.test/${number}.jpg`,
    thumbnail_url: `https://images.test/${number}-small.jpg`,
    original_path: 'private/original/not-for-the-client.jpg',
    view_count: 0,
  }
}

function unavailable(row: Row): Row {
  return { ...row, public_url: null, preview_url: null, thumbnail_url: null }
}

function sortedIds(rows: Row[]) {
  return [...rows].sort((a, b) => -compare('created_at', a.created_at, b.created_at) || -compare('id', a.id, b.id))
    .map((row) => row.id)
}

async function main() {
  const fixture: Fixture = {
    rows: [],
    album: { id: albumId, share_token: 'test-link', is_public: true, status: 'active', is_password_protected: false, password_hash: 'password-hash' },
    allowed: true,
    failPhotos: false,
    queries: [],
  }
  const runtimeFixture = { ...fixture, from: (table: string) => createQuery(fixture, table), allowed: () => fixture.allowed }
  const result = await build({
    stdin: {
      contents: `export { GET } from './src/app/api/share/photos/route'; export { getSharedAlbumPhotos } from './src/lib/share-data'; export { mergeSharedPhotos } from './src/lib/share-photo-updates';`,
      resolveDir: process.cwd(),
      sourcefile: 'share-pagination-regression.ts',
    },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'isolated-share-pagination', setup(builder) {
      builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'db', namespace: 'fixture' }))
      builder.onResolve({ filter: /^next\/cache$/ }, () => ({ path: 'cache', namespace: 'fixture' }))
      builder.onResolve({ filter: /@\/lib\/rate-limit$/ }, () => ({ path: 'rate', namespace: 'fixture' }))
      builder.onResolve({ filter: /@\/lib\/storage\/album-covers$/ }, () => ({ path: 'covers', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'db' ? `
        export function createClient() { return { from: fixture.from }; }
      ` : path === 'cache' ? `
        export function unstable_cache(fn) { return fn; }
      ` : path === 'covers' ? `
        export async function resolveAlbumCoverDeliveries(client, albums) { return albums; }
      ` : `
        export async function rateLimit() { return { allowed: fixture.allowed() }; }
        export function tooManyRequests() { return new Response('{}', { status: 429 }); }
      ` }))
    } }],
  })
  const compiled = { exports: {} as {
    GET: (request: NextRequest) => Promise<Response>
    getSharedAlbumPhotos: (id: string) => Promise<Page & { photoCount: number; syncSince: string }>
    mergeSharedPhotos: (current: Row[], incoming: Row[]) => Row[]
  } }
  new Function('require', 'module', 'exports', 'fixture', result.outputFiles[0].text)(
    createRequire(import.meta.url), compiled, compiled.exports, runtimeFixture,
  )
  const get = (parameters: Record<string, string> = {}, cookie?: string) => compiled.exports.GET(new NextRequest(
    `https://ciiya.test/api/share/photos?${new URLSearchParams({ token: 'test-link', ...parameters })}`,
    { headers: cookie ? { cookie } : undefined },
  ))
  const page = async (cursor: string | null, limit = 50) => {
    const response = await get({ ...(cursor ? { cursor } : {}), limit: String(limit) })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('Cache-Control') || '', /no-store/)
    const value = await response.json() as Page & { success: boolean }
    assert.equal(value.success, true)
    assert.equal(value.hasMore, value.nextCursor !== null)
    if (value.nextCursor !== null) assert.equal(typeof value.nextCursor, 'string')
    return value
  }
  const walk = async (first: Page) => {
    const rows = [...first.photos]
    const cursors = new Set<string>()
    let next = first
    while (next.hasMore) {
      assert.ok(next.nextCursor, 'A raw page with more rows must always supply a cursor')
      assert.ok(!cursors.has(next.nextCursor), 'Cursor must advance even across an empty visible page')
      cursors.add(next.nextCursor)
      assert.ok(cursors.size < 30, 'Pagination must terminate')
      next = await page(next.nextCursor)
      rows.push(...next.photos)
    }
    return rows
  }

  process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-pagination-test-secret'
  fixture.rows = Array.from({ length: 137 }, (_, index) => photo(index + 1))
  fixture.rows.push({ ...photo(900), album_id: 'other-album' }, { ...photo(901), processing_status: 'processing' })
  const first = await compiled.exports.getSharedAlbumPhotos(albumId)
  assert.equal(first.photoCount, 137)
  assert.equal(first.photos.length, 50)
  assert.equal(first.hasMore, true)
  const allTied = await walk(first)
  assert.deepEqual(allTied.map((row) => row.id), sortedIds(fixture.rows.slice(0, 137)))
  assert.equal(new Set(allTied.map((row) => row.id)).size, 137, 'All tied photos appear exactly once')
  assert.ok(fixture.queries.some((query) => query.operations.some((operation) => operation[0] === 'or')))

  fixture.rows = Array.from({ length: 111 }, (_, index) => photo(index + 1,
    `2026-10-01T10:00:00.${String(999999 - index).padStart(6, '0')}+00:00`))
  // Equivalent timezone strings and intentionally opposing IDs catch a
  // timestamp-to-milliseconds conversion or ID-first ordering regression.
  fixture.rows[1].created_at = '2026-10-01T17:00:00.999998+07:00'
  const microseconds = await walk(await compiled.exports.getSharedAlbumPhotos(albumId))
  assert.deepEqual(microseconds.map((row) => row.id), sortedIds(fixture.rows))
  const mergedMicroseconds = compiled.exports.mergeSharedPhotos([], [...fixture.rows].reverse())
  assert.deepEqual(mergedMicroseconds.map((row) => row.id), sortedIds(fixture.rows), 'Client order must retain database microsecond precision')
  const recent = { ...photo(1), updated_at: '2026-10-01T11:00:00.123999+00:00', filename: 'current.jpg' }
  const stale = { ...recent, updated_at: '2026-10-01T11:00:00.123001+00:00', filename: 'stale.jpg' }
  assert.equal(compiled.exports.mergeSharedPhotos([recent], [stale])[0].filename, 'current.jpg')
  assert.equal(compiled.exports.mergeSharedPhotos(allTied, [allTied[0], allTied[50]]).length, 137, 'Realtime overlap must not duplicate paginated photos')

  fixture.rows = Array.from({ length: 137 }, (_, index) => photo(index + 1))
  const legacy = await page(sharedTimestamp)
  const legacyRest = await walk(legacy)
  const legacyAlreadyLoaded = fixture.rows.slice(0, 50)
  const resumedIds = new Set([...legacyAlreadyLoaded, ...legacyRest].map((row) => row.id))
  assert.equal(resumedIds.size, fixture.rows.length, 'A pre-deployment timestamp-only cursor must not skip its tie group')
  assert.ok(fixture.queries.some((query) => query.operations.some((operation) => operation[0] === 'lte')))

  fixture.rows = Array.from({ length: 101 }, (_, index) => {
    const row = photo(index + 1)
    return index >= 51 ? unavailable(row) : row
  })
  const emptyFirst = await compiled.exports.getSharedAlbumPhotos(albumId)
  assert.equal(emptyFirst.photos.length, 0)
  assert.ok(emptyFirst.nextCursor)
  assert.deepEqual((await walk(emptyFirst)).map((row) => row.id), sortedIds(fixture.rows.slice(0, 51)))

  fixture.rows = Array.from({ length: 151 }, (_, index) => {
    const row = photo(index + 1)
    return index >= 51 && index < 101 ? unavailable(row) : row
  })
  const beforeEmpty = await compiled.exports.getSharedAlbumPhotos(albumId)
  const emptyMiddle = await page(beforeEmpty.nextCursor)
  assert.equal(emptyMiddle.photos.length, 0)
  assert.equal(emptyMiddle.hasMore, true)
  const beyondEmpty = [...beforeEmpty.photos, ...await walk(emptyMiddle)]
  assert.deepEqual(beyondEmpty.map((row) => row.id), sortedIds(fixture.rows.filter((row) => row.preview_url)))

  for (const size of [0, 1, 49, 50, 51, 100, 101]) {
    fixture.rows = Array.from({ length: size }, (_, index) => photo(index + 1))
    const initial = await compiled.exports.getSharedAlbumPhotos(albumId)
    assert.equal(initial.hasMore, size > 50, `Initial lookahead at ${size} rows`)
    assert.deepEqual((await walk(initial)).map((row) => row.id), sortedIds(fixture.rows))
  }

  fixture.rows = [photo(1)]
  const safe = await page(null)
  assert.equal(safe.photos[0].original_path, undefined)
  assert.equal(safe.photos[0].storage_provider, undefined)
  for (const cursor of ['{', '{}', 'null', '[]', 'not-a-timestamp', 'now()),id.gt.x', JSON.stringify({ createdAt: sharedTimestamp, id: 'x),id.gt.y' })]) {
    fixture.queries = []
    assert.equal((await get({ cursor })).status, 400, `Reject invalid cursor ${cursor}`)
    assert.equal(fixture.queries.some((query) => query.table === 'photos'), false)
  }
  for (const limit of ['NaN', 'Infinity', 'wrong', '1.5', '0', '-1']) {
    assert.equal((await get({ limit })).status, 400, `Reject invalid limit ${limit}`)
  }
  assert.equal((await get({ token: '' })).status, 400)
  const album = fixture.album!
  album.is_public = false
  fixture.queries = []
  assert.equal((await get()).status, 404)
  assert.equal(fixture.queries.some((query) => query.table === 'photos'), false)
  album.is_public = true
  album.status = 'deleted'
  assert.equal((await get()).status, 404)
  album.status = 'active'
  album.is_password_protected = true
  assert.equal((await get()).status, 401)
  const cookie = `${getShareAuthCookieName(albumId)}=${signShareAuthToken(albumId, String(album.password_hash))}`
  assert.equal((await get({}, cookie)).status, 200)
  album.password_hash = 'changed-password'
  assert.equal((await get({}, cookie)).status, 401, 'Guard must freshly enforce password changes')
  album.is_password_protected = false
  fixture.allowed = false
  assert.equal((await get()).status, 429)
  fixture.allowed = true
  fixture.failPhotos = true
  assert.equal((await get()).status, 500)
  fixture.failPhotos = false
  assert.equal((await get()).status, 200, 'A failed page must be retriable')
  fixture.album = null
  assert.equal((await get()).status, 404)

  console.log('Share pagination checks passed: full tied/microsecond traversal, legacy cursors, empty delivery pages, boundaries, safe DTOs, input validation, authorization and retry.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
