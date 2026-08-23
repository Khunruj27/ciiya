import { NextRequest, NextResponse } from 'next/server'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'
import { getSharedAlbumByToken, getSharedAlbumPhotosPage } from '@/lib/share-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export async function GET(req: NextRequest) {
  try {
    const token = String(req.nextUrl.searchParams.get('token') || '').trim()
    const cursor = req.nextUrl.searchParams.get('cursor')
    const rawLimit = Number(req.nextUrl.searchParams.get('limit') || DEFAULT_LIMIT)
    const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT)

    if (!token) {
      return NextResponse.json({ error: 'share token is required' }, { status: 400 })
    }

    let album: Awaited<ReturnType<typeof getSharedAlbumByToken>> | null = null

    try {
      album = await getSharedAlbumByToken(token)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Shared album not found' },
        { status: 500 }
      )
    }

    if (!album || !isAlbumPubliclyVisible(album)) {
      return NextResponse.json({ error: 'Shared album not found' }, { status: 404 })
    }

    const shareCookie = req.cookies.get(getShareAuthCookieName(album.id))?.value

    if (!hasValidSharePasswordAccess(album, shareCookie)) {
      return NextResponse.json({ error: 'Password required' }, { status: 401 })
    }

    const { photos: rows, hasMore } = await getSharedAlbumPhotosPage(
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
      view_count: photo.view_count,
      processing_status: photo.processing_status,
    }))

    return NextResponse.json(
      {
        success: true,
        photos: safePhotos,
        hasMore,
        nextCursor:
          hasMore && safePhotos.length > 0
            ? safePhotos[safePhotos.length - 1].created_at
            : null,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Load photos failed' },
      { status: 500 }
    )
  }
}
