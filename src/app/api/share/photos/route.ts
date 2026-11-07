import { NextRequest, NextResponse } from 'next/server'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'
import { getSharedAlbumPhotosPage } from '@/lib/share-data'
import { getFreshShareGuard } from '@/lib/share-photo-updates-server'
import { parsePhotoPageCursor } from '@/lib/share-photo-pagination'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const headers = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(req: NextRequest) {
  try {
    // Each call returns up to 100 photos; a generous per-IP cap covers normal
    // "load more" scrolling while stopping a scraper paging the whole album.
    const rate = await rateLimit(req, {
      bucket: 'share-photos',
      limit: 60,
      windowSeconds: 60,
    })

    if (!rate.allowed) {
      return tooManyRequests(rate)
    }

    const token = String(req.nextUrl.searchParams.get('token') || '').trim()
    const rawCursor = req.nextUrl.searchParams.get('cursor')
    const cursor = parsePhotoPageCursor(rawCursor)
    const rawLimit = Number(req.nextUrl.searchParams.get('limit') || DEFAULT_LIMIT)
    const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT)

    if (!token || token.length > 256) {
      return NextResponse.json({ error: 'share token is required' }, { status: 400, headers })
    }

    if ((rawCursor !== null && !cursor) || !Number.isInteger(rawLimit) || rawLimit < 1) {
      return NextResponse.json(
        { error: 'Invalid photo page request' },
        { status: 400, headers }
      )
    }

    const album = await getFreshShareGuard(token)

    if (!album || !isAlbumPubliclyVisible(album)) {
      return NextResponse.json({ error: 'Shared album not found' }, { status: 404, headers })
    }

    const shareCookie = req.cookies.get(getShareAuthCookieName(album.id))?.value

    if (!hasValidSharePasswordAccess(album, shareCookie)) {
      return NextResponse.json({ error: 'Password required' }, { status: 401, headers })
    }

    const { photos: rows, hasMore, nextCursor } = await getSharedAlbumPhotosPage(
      album.id,
      cursor,
      limit
    )

    const safePhotos = rows.map((photo) => ({
      id: photo.id,
      album_id: photo.album_id,
      filename: photo.filename,
      public_url: photo.public_url,
      preview_url: photo.preview_url,
      thumbnail_url: photo.thumbnail_url,
      blur_data_url: photo.blur_data_url,
      created_at: photo.created_at,
      updated_at: photo.updated_at,
      view_count: photo.view_count,
      processing_status: photo.processing_status,
    }))

    return NextResponse.json(
      {
        success: true,
        photos: safePhotos,
        hasMore,
        nextCursor,
      },
      {
        headers,
      }
    )
  } catch {
    return NextResponse.json(
      { error: 'Load photos failed' },
      { status: 500, headers }
    )
  }
}
