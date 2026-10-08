import { NextRequest, NextResponse } from 'next/server'
import {
  MOBILE_PHOTO_PAGE_DEFAULT,
  listOwnerPhotos,
} from '@/lib/mobile/owner-data'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = {
  params: Promise<{ id: string }>
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A page of photos (newest first) in one of the signed-in photographer's
// albums, with delivery URLs resolved the same way the web album page does.
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: albumId } = await params

    if (!UUID_PATTERN.test(albumId)) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    const cursor = req.nextUrl.searchParams.get('cursor')

    if (cursor && (cursor.length > 64 || Number.isNaN(Date.parse(cursor)))) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
    }

    const limit = Number(
      req.nextUrl.searchParams.get('limit') || MOBILE_PHOTO_PAGE_DEFAULT
    )

    const page = await listOwnerPhotos(supabase, user.id, albumId, {
      cursor,
      limit: Number.isFinite(limit) ? limit : MOBILE_PHOTO_PAGE_DEFAULT,
    })

    if (!page) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    return NextResponse.json(page, { headers: NO_STORE })
  } catch (error) {
    console.error(
      '[mobile/albums] photos failed:',
      error instanceof Error ? error.message : error
    )

    return NextResponse.json({ error: 'Load photos failed' }, { status: 500 })
  }
}
