import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { NextRequest } from 'next/server'
import { getShareAuthCookieName, signShareAuthToken } from '../src/lib/share-access'
import { isUpdateTimestamp, mergeSharedPhotos, parsePhotoUpdateCursor, type SharedPhoto } from '../src/lib/share-photo-updates'

async function main() {
  const id = '11111111-1111-4111-8111-111111111111'
  const timestamp = '2026-10-01T10:00:00.123456+00:00'
  assert.equal(isUpdateTimestamp(timestamp), true)
  assert.equal(isUpdateTimestamp('now()),id.gt.x'), false)
  assert.equal(parsePhotoUpdateCursor('{'), null)
  assert.equal(parsePhotoUpdateCursor(JSON.stringify({ updatedAt: timestamp, id: 'x),id.gt.y' })), null)
  assert.equal(parsePhotoUpdateCursor(JSON.stringify({ updatedAt: timestamp, id }))?.updatedAt, timestamp)
  const photo: SharedPhoto = {
    id, album_id: 'album', filename: 'first.jpg', public_url: 'https://images.test/p.jpg',
    preview_url: 'https://images.test/p.jpg', thumbnail_url: 'https://images.test/t.jpg',
    created_at: '2026-09-01T00:00:00Z', updated_at: timestamp, processing_status: 'done',
  }
  const merged = mergeSharedPhotos([], [photo, photo, { ...photo, id: 'pending', processing_status: 'processing' }])
  assert.equal(merged.length, 1)
  assert.equal(mergeSharedPhotos(merged, [photo]), merged, 'unchanged polls preserve array identity')
  assert.equal(mergeSharedPhotos(merged, [{ ...photo, updated_at: '2026-01-01T00:00:00Z', filename: 'stale' }])[0].filename, 'first.jpg')
  assert.equal(mergeSharedPhotos(merged, [{ ...photo, filename: 'updated.jpg' }])[0].filename, 'updated.jpg')
  assert.equal(mergeSharedPhotos(merged, [{ ...photo, id: 'new', created_at: '2026-10-01T00:00:00Z' }])[0].id, 'new')

  // Execute the real route + query builder + R2 delivery resolver with an
  // in-memory database. No credentials or production writes are needed.
  const state = {
    album: { id: 'album', is_public: true, status: 'active', is_password_protected: false, password_hash: 'hash' },
    rows: [] as Record<string, unknown>[],
    calls: [] as unknown[][],
    allowed: true,
    failure: false,
  }
  const built = await build({
    entryPoints: ['src/app/api/share/photos/updates/route.ts'],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'in-memory-share-api', setup(builder) {
      builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'db', namespace: 'fixture' }))
      builder.onResolve({ filter: /@\/lib\/rate-limit$/ }, () => ({ path: 'rate', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'rate' ? `
        export async function rateLimit() { return { allowed: fixture.allowed }; }
        export function tooManyRequests() { return new Response('{}', {status: 429}); }
      ` : `
        export function createClient() { return { from(table) {
          fixture.calls.push(['from', table]);
          const query = {};
          for (const method of ['select','eq','gte','order','limit','or']) query[method] = (...args) => {
            fixture.calls.push([method, ...args]); return query;
          };
          query.maybeSingle = async () => ({ data: fixture.album, error: null });
          query.then = (resolve) => resolve({ data: fixture.rows, error: fixture.failure ? new Error('private detail') : null });
          return query;
        }}; }
      ` }))
    } }],
  })
  const compiledRoute = { exports: {} as { GET: (request: NextRequest) => Promise<Response> } }
  new Function('require', 'module', 'exports', 'fixture', built.outputFiles[0].text)(createRequire(import.meta.url), compiledRoute, compiledRoute.exports, state)
  const get = (params: Record<string, string> = {}, cookie?: string) => compiledRoute.exports.GET(new NextRequest(
    `https://ciiya.test/api/share/photos/updates?${new URLSearchParams({ token: 'test-link', since: timestamp, ...params })}`,
    { headers: cookie ? { cookie } : undefined },
  ))
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-secret'
  process.env.R2_PUBLIC_BASE_URL = 'https://images.test'
  state.album.is_public = false
  assert.equal((await get()).status, 404)
  assert.equal(state.calls.some((call) => call[1] === 'photos'), false)
  state.album.is_public = true
  state.album.is_password_protected = true
  assert.equal((await get()).status, 401)
  assert.equal((await get({}, `${getShareAuthCookieName('album')}=wrong`)).status, 401)
  const cookie = `${getShareAuthCookieName('album')}=${signShareAuthToken('album', 'hash')}`
  assert.equal((await get({}, cookie)).status, 200)
  state.album.password_hash = 'new-hash'
  assert.equal((await get({}, cookie)).status, 401, 'changed passwords revoke existing cookies')
  state.album.is_password_protected = false
  assert.equal((await get({ since: 'bad' })).status, 400)
  assert.equal((await get({ cursor: '{}' })).status, 400)
  state.allowed = false
  assert.equal((await get()).status, 429)
  state.allowed = true
  state.failure = true
  const failure = await get()
  assert.equal(failure.status, 500)
  assert.doesNotMatch(await failure.text(), /private detail/)
  state.failure = false
  state.rows = Array.from({ length: 101 }, (_, i) => ({
    ...photo, id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    storage_provider: 'r2', public_url: null, preview_url: null, thumbnail_url: null,
    preview_path: 'owner/album/preview/test.jpg', thumbnail_path: 'owner/album/thumbnail/test.jpg',
    original_path: 'owner/album/original/private.jpg',
  }))
  state.calls = []
  const response = await get()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Cache-Control')!, /no-store/)
  const data = await response.json()
  assert.equal(data.photos.length, 100)
  assert.equal(data.photos[0].preview_url, 'https://images.test/owner/album/preview/test.jpg')
  assert.equal(data.photos[0].original_path, undefined)
  assert.equal(data.photos[0].storage_provider, undefined)
  assert.equal(data.nextCursor.updatedAt, timestamp)
  assert.equal(data.nextCursor.id, state.rows[99].id)
  assert.ok(state.calls.some((call) => call[0] === 'eq' && call[1] === 'album_id' && call[2] === 'album'))
  assert.ok(state.calls.some((call) => call[0] === 'gte' && call[1] === 'updated_at'))
  assert.ok(state.calls.some((call) => call[0] === 'eq' && call[1] === 'processing_status' && call[2] === 'done'))
  state.calls = []
  state.rows = state.rows.slice(100)
  const last = await (await get({ cursor: JSON.stringify(data.nextCursor) })).json()
  assert.equal(last.photos.length, 1)
  assert.equal(last.nextCursor, null)
  assert.ok(state.calls.some((call) => call[0] === 'or' && String(call[1]).includes(`updated_at.eq.${timestamp},id.gt.${data.nextCursor.id}`)))
  console.log('Share live-update checks passed: merge, late completion, cursors, paging, R2 URLs, safe DTO, authorization, rate limits, failures.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
