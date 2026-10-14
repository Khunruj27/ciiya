import { NextResponse } from 'next/server'
import { listOwnerAlbums } from '@/lib/mobile/owner-data'
import { createMobileSupabaseClient } from '@/lib/mobile/server-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

// The signed-in photographer's albums for the mobile app.
export async function GET() {
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

    const albums = await listOwnerAlbums(supabase, user.id)

    return NextResponse.json({ albums }, { headers: NO_STORE })
  } catch (error) {
    console.error(
      '[mobile/albums] list failed:',
      error instanceof Error ? error.message : error
    )

    return NextResponse.json({ error: 'Load albums failed' }, { status: 500, headers: NO_STORE })
  }
}
