import type { NextRequest } from 'next/server'
import { albumEditJson, isAlbumEditId, readAlbumDetails } from '@/lib/mobile/album-edit'
import { createMobileSupabaseClient } from '@/lib/mobile/server-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/** Native metadata-only edit; existing browser settings authentication is unchanged. */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    // Pass even an absent header explicitly: never inherit ambient auth/cookies.
    const supabase = await createMobileSupabaseClient(req.headers.get('authorization'))
    if (!supabase) return albumEditJson({ error: 'Unauthorized' }, 401)

    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user || !isAlbumEditId(auth.user.id)) {
      return albumEditJson({ error: 'Unauthorized' }, 401)
    }

    const { id } = await params
    if (!isAlbumEditId(id)) return albumEditJson({ error: 'Album not found' }, 404)
    const albumId = id.toLowerCase()

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return albumEditJson({ error: 'Invalid album details' }, 400)
    }
    const details = readAlbumDetails(body)
    if (!details) return albumEditJson({ error: 'Invalid album details' }, 400)

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id')
      .eq('id', albumId)
      .eq('owner_id', auth.user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (albumError) return albumEditJson({ error: 'Unable to save album details' }, 500)
    if (album?.id !== albumId) return albumEditJson({ error: 'Album not found' }, 404)

    const { data: updated, error: updateError } = await supabase
      .from('albums')
      .update(details)
      .eq('id', albumId)
      .eq('owner_id', auth.user.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle()

    if (updateError) return albumEditJson({ error: 'Unable to save album details' }, 500)
    // RLS, removal or a status/owner change must never produce phantom success.
    if (updated?.id !== albumId) return albumEditJson({ error: 'Album not found' }, 404)

    return albumEditJson({ success: true })
  } catch {
    // Do not expose/log raw auth/DB errors, identifiers or private object URLs.
    return albumEditJson({ error: 'Unable to save album details' }, 500)
  }
}
