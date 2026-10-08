import { NextRequest, NextResponse } from 'next/server'
import { getOwnerAlbum } from '@/lib/mobile/owner-data'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = {
  params: Promise<{ id: string }>
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// One of the signed-in photographer's albums for the mobile app.
export async function GET(_req: NextRequest, { params }: RouteParams) {
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

    const album = await getOwnerAlbum(supabase, user.id, albumId)

    if (!album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    return NextResponse.json({ album }, { headers: NO_STORE })
  } catch (error) {
    console.error(
      '[mobile/albums] get failed:',
      error instanceof Error ? error.message : error
    )

    return NextResponse.json({ error: 'Load album failed' }, { status: 500 })
  }
}
