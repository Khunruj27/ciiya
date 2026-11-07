import type { NextRequest } from 'next/server'
import {
  albumEditJson,
  isAlbumEditId,
  readAlbumCoverPhotoId,
  resolveAlbumEditCoverUrl,
} from '@/lib/mobile/album-edit'
import { createMobileSupabaseClient } from '@/lib/mobile/server-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/** Native cover metadata only. No original URL, object write, or cookie fallback. */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
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
      return albumEditJson({ error: 'Invalid cover photo' }, 400)
    }
    const photoId = readAlbumCoverPhotoId(body)
    if (!photoId) return albumEditJson({ error: 'Invalid cover photo' }, 400)

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id')
      .eq('id', albumId)
      .eq('owner_id', auth.user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (albumError) return albumEditJson({ error: 'Unable to save album cover' }, 500)
    if (album?.id !== albumId) return albumEditJson({ error: 'Album not found' }, 404)

    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select('id,owner_id,album_id,processing_status,storage_provider,storage_bucket,preview_path,thumbnail_path')
      .eq('id', photoId)
      .eq('album_id', albumId)
      .eq('owner_id', auth.user.id)
      .maybeSingle()

    if (photoError) return albumEditJson({ error: 'Unable to save album cover' }, 500)
    if (
      photo?.id !== photoId ||
      photo.album_id !== albumId ||
      photo.owner_id !== auth.user.id
    ) return albumEditJson({ error: 'Photo not found' }, 404)
    if (photo.processing_status !== 'done') {
      return albumEditJson({ error: 'Cover photo is not ready' }, 409)
    }

    const coverUrl = resolveAlbumEditCoverUrl(photo, auth.user.id, albumId)
    if (!coverUrl) return albumEditJson({ error: 'Cover photo is not ready' }, 409)

    const { data: updated, error: updateError } = await supabase
      .from('albums')
      .update({ cover_photo_id: photoId, cover_url: coverUrl })
      .eq('id', albumId)
      .eq('owner_id', auth.user.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle()

    if (updateError) return albumEditJson({ error: 'Unable to save album cover' }, 500)
    if (updated?.id !== albumId) return albumEditJson({ error: 'Album not found' }, 404)

    return albumEditJson({ success: true })
  } catch {
    return albumEditJson({ error: 'Unable to save album cover' }, 500)
  }
}
