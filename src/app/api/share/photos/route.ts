import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

const SUCCESS_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const albumId = String(req.nextUrl.searchParams.get('albumId') || '').trim()
    const cursor = req.nextUrl.searchParams.get('cursor')
    const rawLimit = Number(
      req.nextUrl.searchParams.get('limit') || DEFAULT_LIMIT
    )
    const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT)

    if (!albumId) {
      return NextResponse.json(
        { error: 'albumId is required' },
        { status: 400 }
      )
    }

    let query = supabase
      .from('photos')
      .select(
        `
        id,
        album_id,
        filename,
        public_url,
        preview_url,
        thumbnail_url,
        created_at,
        view_count,
        processing_status
        `
      )
      .eq('album_id', albumId)
      .eq('processing_status', 'done')
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
    const photos = hasMore ? rows.slice(0, limit) : rows

    const nextCursor =
      hasMore && photos.length > 0
        ? photos[photos.length - 1].created_at
        : null

    return NextResponse.json(
      {
        success: true,
        photos,
        nextCursor,
        hasMore,
      },
      {
        headers: SUCCESS_CACHE_HEADERS,
      }
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Load photos failed',
      },
      { status: 500 }
    )
  }
}