import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const token = String(req.nextUrl.searchParams.get('token') || '').trim()
    const cursor = req.nextUrl.searchParams.get('cursor')
    const rawLimit = Number(req.nextUrl.searchParams.get('limit') || DEFAULT_LIMIT)
    const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT)

    if (!token) {
      return NextResponse.json({ error: 'share token is required' }, { status: 400 })
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, status, is_public, is_password_protected, password_hash')
      .eq('share_token', token)
      .maybeSingle()

    if (albumError || !album || !isAlbumPubliclyVisible(album)) {
      return NextResponse.json(
        { error: albumError?.message || 'Shared album not found' },
        { status: 404 }
      )
    }

    const safeAlbum = album

    const shareCookie = req.cookies.get(
      getShareAuthCookieName(safeAlbum.id)
    )?.value

    if (!hasValidSharePasswordAccess(safeAlbum, shareCookie)) {
      return NextResponse.json(
        { error: 'Password required' },
        { status: 401 }
      )
    }

    let query = supabase
      .from('photos')
      .select(`
        id,
        album_id,
        filename,
        public_url,
        preview_url,
        thumbnail_url,
        blur_data_url,
        created_at,
        view_count,
        processing_status
      `)
      .eq('album_id', safeAlbum.id)
      .eq('processing_status', 'done')
      .not('preview_url', 'is', null)
      .not('thumbnail_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = data ?? []
    const hasMore = rows.length > limit
    const safePhotos = (hasMore ? rows.slice(0, limit) : rows).map((photo) => ({
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