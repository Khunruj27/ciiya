import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { NextRequest } from 'next/server'
import { getShareAuthCookieName, signShareAuthToken } from '../src/lib/share-access'

// Execute the real endpoint with an in-memory database and limiter. This
// suite needs no production credentials and never increments a real album.
type Album = {
  id: string; owner_id: string | null; user_id: string; view_count: number
  is_public: boolean; status: string; is_password_protected: boolean; password_hash: string | null
}
const baseAlbum = (): Album => ({
  id: 'fixture-album', owner_id: 'fixture-owner', user_id: 'fixture-owner', view_count: 10,
  is_public: true, status: 'active', is_password_protected: false, password_hash: 'fixture-hash',
})
const state = {
  albums: { 'fixture-token': baseAlbum() } as Record<string, Album>,
  allowed: true, lookupError: false, rpcError: false, eventError: false,
  createError: false, rpcCode: '40001', rpcLostResponse: false,
  afterTasks: [] as (() => Promise<void>)[],
  eventWait: null as Promise<void> | null,
  calls: [] as unknown[][], events: [] as Record<string, unknown>[],
}
function reset() {
  state.albums = { 'fixture-token': baseAlbum() }
  state.allowed = true
  state.lookupError = state.rpcError = state.eventError = state.createError = state.rpcLostResponse = false
  state.rpcCode = '40001'
  state.afterTasks = []
  state.eventWait = null
  state.calls = []
  state.events = []
}
const viewCookie = (token = 'fixture-token') =>
  `ciiya_viewed_${createHash('sha256').update(token).digest('hex').slice(0, 24)}=${Date.now() + 21_600_000}`

async function main() {
  const built = await build({
    entryPoints: ['src/app/api/share/view/route.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'isolated-share-view-api', setup(builder) {
      builder.onResolve({ filter: /^next\/server$/, namespace: 'file' }, () => ({ path: 'next', namespace: 'fixture' }))
      builder.onResolve({ filter: /^next\/server$/, namespace: 'fixture' }, () => ({ path: 'next/server', external: true }))
      builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'db', namespace: 'fixture' }))
      builder.onResolve({ filter: /@\/lib\/rate-limit$/ }, () => ({ path: 'rate', namespace: 'fixture' }))
      builder.onResolve({ filter: /@\/lib\/supabase-server$/ }, () => ({ path: 'forbidden', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'next' ? `
        export {NextRequest, NextResponse} from 'next/server';
        export function after(callback) { fixture.afterTasks.push(callback); }
      ` : path === 'rate' ? `
        export async function rateLimit(req, options) {
          fixture.calls.push(['rate', options]); return { allowed: fixture.allowed };
        }
        export function tooManyRequests() { return new Response('{}', {status: 429}); }
      ` : path === 'forbidden' ? `
        export function createServerSupabaseClient() { throw new Error('Anonymous client must not be used'); }
      ` : `
        export function createClient(url, key, options) {
          fixture.calls.push(['client', key, options]);
          if (fixture.createError) throw new Error('private database detail');
          return {
            from(table) {
              fixture.calls.push(['from', table]);
              let selected = '', filter = '', value = '';
              const query = {
                select(columns) { selected = columns; return query; },
                eq(column, val) { filter = column; value = val; return query; },
                async maybeSingle() {
                  fixture.calls.push(['read', selected, filter, value]);
                  if (fixture.lookupError) return {data: null, error: {code: 'TEST', message: 'private database detail'}};
                  const album = filter === 'share_token' ? fixture.albums[value]
                    : Object.values(fixture.albums).find(row => row.id === value);
                  return {data: album ? {...album} : null, error: null};
                },
                update() { throw new Error('Non-atomic counter update must not be used'); },
                async insert(event) {
                  if (fixture.eventWait) await fixture.eventWait;
                  if (fixture.eventError) throw new Error('private event detail');
                  fixture.events.push(event); return {error: null};
                },
              };
              return query;
            },
            async rpc(name, args) {
              fixture.calls.push(['rpc', name, args]);
              if (fixture.rpcError) return {error: {code: fixture.rpcCode, message: 'private database detail'}};
              await Promise.resolve();
              const album = Object.values(fixture.albums).find(row => row.id === args.album_id);
              if (!album) throw new Error('Unknown increment target');
              album.view_count++;
              if (fixture.rpcLostResponse) throw new Error('Lost upstream response after commit');
              return {error: null};
            },
          };
        }
      ` }))
    } }],
  })
  const compiled = { exports: {} as { POST: (req: NextRequest) => Promise<Response> } }
  new Function('require', 'module', 'exports', 'fixture', built.outputFiles[0].text)(
    createRequire(import.meta.url), compiled, compiled.exports, state,
  )
  const previousSecret = process.env.SUPABASE_SERVICE_ROLE_KEY
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-service-secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.test'
  const post = (token: unknown = 'fixture-token', cookie?: string) => compiled.exports.POST(new NextRequest(
    'https://ciiya.test/api/share/view', {
      method: 'POST', body: JSON.stringify({ token }),
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    },
  ))
  const mutations = () => state.calls.filter(call => call[0] === 'rpc').length
  const flushEvents = () => Promise.all(state.afterTasks.splice(0).map(task => task()))
  const assertDenied = async (status: number, token: unknown = 'fixture-token', cookie?: string) => {
    const response = await post(token, cookie)
    assert.equal(response.status, status)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(mutations(), 0)
    assert.equal(state.events.length, 0)
    assert.equal(state.afterTasks.length, 0)
    assert.doesNotMatch(await response.text(), /fixture-hash|fixture-owner|private database detail/)
  }
  try {
    for (const token of ['', ' ', 123, {}, 'a'.repeat(257)]) {
      reset()
      await assertDenied(400, token)
      assert.equal(state.calls.length, 0)
    }
    reset()
    state.allowed = false
    await assertDenied(429)
    assert.equal(state.calls.some(call => call[0] === 'client'), false)
    reset()
    await assertDenied(404, 'unknown-token')
    for (const status of ['deleted', 'draft', 'archived']) {
      reset()
      state.albums['fixture-token'].status = status
      await assertDenied(404, 'fixture-token', viewCookie())
    }
    reset()
    state.albums['fixture-token'].is_public = false
    await assertDenied(404, 'fixture-token', viewCookie())

    reset()
    state.albums['fixture-token'].is_password_protected = true
    await assertDenied(401)
    await assertDenied(401, 'fixture-token', `${getShareAuthCookieName('fixture-album')}=wrong`)
    const passwordCookie = `${getShareAuthCookieName('fixture-album')}=${signShareAuthToken('fixture-album', 'fixture-hash')}`
    state.albums['fixture-token'].password_hash = 'changed-hash'
    await assertDenied(401, 'fixture-token', passwordCookie)
    state.albums['fixture-token'].password_hash = null
    await assertDenied(401, 'fixture-token', passwordCookie)
    state.albums['fixture-token'].password_hash = 'fixture-hash'
    const protectedResponse = await post('fixture-token', passwordCookie)
    assert.equal((await protectedResponse.json()).counted, true)
    assert.equal(mutations(), 1)
    await flushEvents()

    reset()
    const anonymous = await post()
    assert.equal(anonymous.status, 200)
    const anonymousPayload = await anonymous.json()
    assert.equal(anonymousPayload.counted, true)
    assert.equal(anonymousPayload.mode, 'rpc')
    assert.equal(anonymousPayload.view_count, null, 'do not delay a committed view for an optional counter read')
    assert.ok(anonymousPayload.view_expires_at > Date.now())
    assert.ok(anonymous.headers.get('set-cookie')!.includes(`=${anonymousPayload.view_expires_at};`))
    assert.match(anonymous.headers.get('set-cookie')!, /Max-Age=21600.*HttpOnly.*SameSite=lax/i)
    assert.match(anonymous.headers.get('Cache-Control')!, /no-store/)
    assert.equal(state.calls.find(call => call[0] === 'client')?.[1], 'isolated-service-secret')
    assert.deepEqual(state.calls.find(call => call[0] === 'rpc'), ['rpc', 'increment_album_views', { album_id: 'fixture-album' }])
    assert.equal(state.events.length, 0, 'analytics runs only after the response')
    await flushEvents()
    assert.equal(state.events.length, 1)
    assert.equal(state.events[0].event_type, 'album_view')
    const skipped = await post('fixture-token', viewCookie())
    assert.equal((await skipped.json()).counted, false)
    assert.equal(mutations(), 1)
    assert.equal(state.events.length, 1)
    const nearExpiry = Date.now() + 60_000
    const nearCookie = viewCookie().replace(/=\d+$/, `=${nearExpiry}`)
    const nearSkip = await (await post('fixture-token', nearCookie)).json()
    assert.equal(nearSkip.view_expires_at, nearExpiry, 'cookie-skip preserves the original expiry')
    assert.equal(mutations(), 1)
    const expiredCookie = viewCookie().replace(/=\d+$/, `=${Date.now() - 1_000}`)
    assert.equal((await (await post('fixture-token', expiredCookie)).json()).counted, true)
    assert.equal(mutations(), 2, 'an expired cookie must not suppress the next visit')

    // Entire-token cookie hashing avoids prefix collisions between galleries.
    reset()
    const first = 'a'.repeat(24) + 'first'
    const second = 'a'.repeat(24) + 'second'
    state.albums = { [first]: { ...baseAlbum(), id: 'first' }, [second]: { ...baseAlbum(), id: 'second' } }
    const collisionResponse = await post(second, viewCookie(first))
    assert.equal((await collisionResponse.json()).counted, true)
    assert.equal(state.albums[second].view_count, 11)
    assert.equal(state.albums[first].view_count, 10)

    for (const failure of ['lookupError', 'rpcError', 'createError'] as const) {
      reset()
      state[failure] = true
      const failed = await post()
      assert.equal(failed.status, 503)
      assert.equal(failed.headers.get('set-cookie'), null)
      const payload = await failed.json()
      assert.equal(payload.success, false)
      assert.equal(payload.counted, false)
      assert.equal(payload.retryable, true)
      assert.doesNotMatch(JSON.stringify(payload), /private database detail/)
      assert.equal(state.albums['fixture-token'].view_count, 10)
      assert.equal(state.events.length, 0)
      state[failure] = false
      assert.equal((await (await post()).json()).counted, true)
      assert.equal(state.albums['fixture-token'].view_count, 11)
    }
    reset()
    state.eventError = true
    const ancillaryFailure = await post()
    assert.equal(ancillaryFailure.status, 200)
    assert.equal((await ancillaryFailure.json()).counted, true)
    assert.ok(ancillaryFailure.headers.get('set-cookie'))
    assert.equal(state.albums['fixture-token'].view_count, 11)
    await flushEvents()

    reset()
    let releaseEvent!: () => void
    state.eventWait = new Promise(resolve => { releaseEvent = resolve })
    const slowAnalytics = await post()
    assert.equal((await slowAnalytics.json()).counted, true)
    assert.ok(slowAnalytics.headers.get('set-cookie'), 'slow analytics cannot delay the cookie')
    const deferred = flushEvents()
    assert.equal(state.events.length, 0)
    releaseEvent()
    await deferred
    assert.equal(state.events.length, 1)

    reset()
    state.rpcLostResponse = true
    const ambiguous = await post()
    assert.equal(ambiguous.status, 503)
    assert.equal((await ambiguous.json()).retryable, false, 'lost RPC responses must not be immediately retried')
    assert.equal(state.albums['fixture-token'].view_count, 11)
    assert.equal(ambiguous.headers.get('set-cookie'), null)
    reset()
    state.rpcError = true
    state.rpcCode = '08006'
    assert.equal((await (await post()).json()).retryable, false, 'connection failures have ambiguous outcomes')

    reset()
    const concurrent = await Promise.all(Array.from({ length: 25 }, () => post()))
    assert.ok((await Promise.all(concurrent.map(response => response.json()))).every(row => row.counted))
    assert.equal(state.albums['fixture-token'].view_count, 35)
    assert.equal(mutations(), 25)
    await flushEvents()
    assert.equal(state.events.length, 25)
    // Also verify the real database function is a single atomic UPDATE, not
    // merely relying on the fixture's concurrency behavior.
    const schema = await readFile('supabase/schema.sql', 'utf8')
    const increment = schema.split('function public.increment_album_views(album_id uuid)')[1].split('$$;')[0]
    assert.match(increment, /set view_count = coalesce\(view_count, 0\) \+ 1/)
    assert.match(increment, /where id = album_id/)
    console.log('Share view API checks passed: anonymous service boundary, fresh access/password guards, deduplication, atomic increments, retries, safe errors and best-effort analytics.')
  } finally {
    if (previousSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSecret
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
