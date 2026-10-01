import { NextRequest, NextResponse } from 'next/server'
import { getShareAuthCookieName, hasValidSharePasswordAccess, isAlbumPubliclyVisible } from '@/lib/share-access'
import { isUpdateTimestamp, parsePhotoUpdateCursor } from '@/lib/share-photo-updates'
import { getFreshShareGuard, getSharedPhotoUpdates } from '@/lib/share-photo-updates-server'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(req: NextRequest) {
  try {
    const rate = await rateLimit(req, { bucket: 'share-photo-updates', limit: 120, windowSeconds: 60 })
    if (!rate.allowed) return tooManyRequests(rate)

    const params = req.nextUrl.searchParams
    const token = params.get('token')?.trim()
    const since = params.get('since') || ''
    const rawCursor = params.get('cursor')
    const cursor = parsePhotoUpdateCursor(rawCursor)
    if (!token || !isUpdateTimestamp(since) || (rawCursor !== null && !cursor)) {
      return NextResponse.json({ error: 'Invalid update request' }, { status: 400, headers })
    }
    const album = await getFreshShareGuard(token)
    if (!album || !isAlbumPubliclyVisible(album)) {
      return NextResponse.json({ error: 'Shared album not found' }, { status: 404, headers })
    }
    const cookie = req.cookies.get(getShareAuthCookieName(album.id))?.value
    if (!hasValidSharePasswordAccess(album, cookie)) {
      return NextResponse.json({ error: 'Password required' }, { status: 401, headers })
    }
    const updates = await getSharedPhotoUpdates(album.id, since, cursor)
    return NextResponse.json({ success: true, ...updates }, { headers })
  } catch {
    return NextResponse.json({ error: 'Unable to check new photos' }, { status: 500, headers })
  }
}
