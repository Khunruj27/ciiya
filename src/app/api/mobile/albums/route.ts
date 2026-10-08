import { NextResponse } from 'next/server'
import { listOwnerAlbums } from '@/lib/mobile/owner-data'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// The signed-in photographer's albums for the mobile app.
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const albums = await listOwnerAlbums(supabase, user.id)

    return NextResponse.json({ albums }, { headers: NO_STORE })
  } catch (error) {
    console.error(
      '[mobile/albums] list failed:',
      error instanceof Error ? error.message : error
    )

    return NextResponse.json({ error: 'Load albums failed' }, { status: 500 })
  }
}
