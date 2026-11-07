import { NextRequest, NextResponse } from 'next/server'
import {
  MOBILE_PHOTO_PAGE_DEFAULT,
  MOBILE_PHOTO_PAGE_MAX,
  listOwnerPhotos,
} from '@/lib/mobile/owner-data'
import { parsePhotoPageCursor } from '@/lib/share-photo-pagination'
import { createMobileSupabaseClient } from '@/lib/mobile/server-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = {
  params: Promise<{ id: string }>
}

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A page of photos (newest first) in one of the signed-in photographer's
// albums, with delivery URLs resolved the same way the web album page does.
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createMobileSupabaseClient()

    if (!supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
    }

    const { id: albumId } = await params

    if (!UUID_PATTERN.test(albumId)) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
    }

    const cursor = req.nextUrl.searchParams.get('cursor')

    if (cursor !== null && !parsePhotoPageCursor(cursor)) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400, headers: NO_STORE })
    }

    const rawIds = req.nextUrl.searchParams.get('ids')
    const photoIds = rawIds === null ? undefined : rawIds.split(',')
    if (photoIds && (
      rawIds!.length > MOBILE_PHOTO_PAGE_MAX * 37 ||
      photoIds.length > MOBILE_PHOTO_PAGE_MAX ||
      photoIds.some((id) => !UUID_PATTERN.test(id)) ||
      cursor !== null
    )) {
      return NextResponse.json({ error: 'Invalid photo IDs' }, { status: 400, headers: NO_STORE })
    }

    const limit = Number(
      req.nextUrl.searchParams.get('limit') || MOBILE_PHOTO_PAGE_DEFAULT
    )

    const page = await listOwnerPhotos(supabase, user.id, albumId, {
      cursor,
      limit: Number.isFinite(limit) ? limit : MOBILE_PHOTO_PAGE_DEFAULT,
      photoIds,
    })

    if (!page) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
    }

    return NextResponse.json(page, { headers: NO_STORE })
  } catch (error) {
    console.error(
      '[mobile/albums] photos failed:',
      error instanceof Error ? error.message : error
    )

    return NextResponse.json({ error: 'Load photos failed' }, { status: 500, headers: NO_STORE })
  }
}
