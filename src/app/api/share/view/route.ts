import { createHash } from 'node:crypto'
import { after, NextRequest, NextResponse } from 'next/server'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'
import {
  getShareEventsAdmin,
  recordShareEvent,
} from '@/lib/share-events'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { VIEW_WINDOW_MS } from '@/lib/share-view-tracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VIEW_COOKIE_MAX_AGE = VIEW_WINDOW_MS / 1000
const headers = { 'Cache-Control': 'private, no-store, max-age=0' }

function makeViewCookieName(token: string) {
  // Hash the whole capability: two tokens with the same prefix must not
  // suppress each other's views, and raw tokens need not appear in cookies.
  return `ciiya_viewed_${createHash('sha256').update(token).digest('hex').slice(0, 24)}`
}

export async function POST(req: NextRequest) {
  let retryable = true
  try {
    const body = await req.json().catch(() => null)

    const token = typeof body?.token === 'string' ? body.token.trim() : ''

    if (!token || token.length > 256) {
      return NextResponse.json(
        {
          success: false,
          error: 'token is required',
        },
        {
          status: 400,
          headers,
        }
      )
    }

    const rate = await rateLimit(req, { bucket: 'share-view', limit: 120, windowSeconds: 60 })
    if (!rate.allowed) return tooManyRequests(rate)

    // Anonymous album reads/writes are intentionally denied by RLS. Use the
    // existing server-only service client, but never increment before the
    // fresh token, visibility, and signed-password guards below have passed.
    const supabase = getShareEventsAdmin()
    const cookieName = makeViewCookieName(token)
    const viewedUntil = Number(req.cookies.get(cookieName)?.value)

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select(
        'id, owner_id, user_id, view_count, is_public, status, is_password_protected, password_hash'
      )
      .eq('share_token', token)
      .maybeSingle()

    if (albumError) throw albumError

    if (!album || !isAlbumPubliclyVisible(album)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Album not found',
        },
        {
          status: 404,
          headers,
        }
      )
    }

    const shareCookie = req.cookies.get(
      getShareAuthCookieName(album.id)
    )?.value

    if (!hasValidSharePasswordAccess(album, shareCookie)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Password required',
        },
        {
          status: 401,
          headers,
        }
      )
    }

    const currentViewCount = Number(album.view_count || 0)
    const now = Date.now()
    const alreadyViewed = viewedUntil > now && viewedUntil <= now + VIEW_WINDOW_MS

    if (alreadyViewed) {
      return NextResponse.json({
        success: true,
        view_count: currentViewCount,
        counted: false,
        mode: 'cookie-skip',
        view_expires_at: viewedUntil,
      }, { headers })
    }

    // Once a mutation starts, a transport failure has an ambiguous outcome.
    // Do not tell the browser to immediately repeat a possibly committed view.
    retryable = false
    const { error: rpcError } = await supabase.rpc('increment_album_views', {
      album_id: album.id,
    })

    // Only the database's atomic increment is safe under concurrent viewers.
    // Never overwrite the counter from a stale read or claim a failed write
    // succeeded (that would suppress all retries for six hours).
    if (rpcError) {
      // PostgreSQL statement errors (excluding connection failures) roll the
      // UPDATE back. These explicit failures, unlike a lost response, can retry.
      retryable = /^[0-9A-Z]{5}$/.test(rpcError.code || '') && !rpcError.code.startsWith('08')
      throw rpcError
    }

    // Deliver the dedupe cookie immediately after commit. Analytics must not
    // hold up that response; owners read the authoritative total from albums.
    try {
      after(async () => {
        try {
          await recordShareEvent(supabase, {
            albumId: album.id,
            ownerId: album.owner_id || album.user_id,
            eventType: 'album_view',
          })
        } catch {
          console.warn('[share/view] event unavailable after increment')
        }
      })
    } catch {
      console.warn('[share/view] unable to schedule event after increment')
    }

    const expiresAt = Date.now() + VIEW_WINDOW_MS
    const response = NextResponse.json({
      success: true,
      view_count: null,
      counted: true,
      mode: 'rpc',
      view_expires_at: expiresAt,
    }, { headers })

    response.cookies.set(cookieName, String(expiresAt), {
      maxAge: VIEW_COOKIE_MAX_AGE,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })

    return response
  } catch (error) {
    console.error('[share/view] unable to count view:',
      error && typeof error === 'object' && 'code' in error ? error.code : 'unavailable')

    return NextResponse.json({
      success: false,
      counted: false,
      retryable,
      error: 'Unable to count view. Please try again.',
    }, { status: 503, headers })
  }
}
