import type { NextRequest } from 'next/server'
import {
  PHOTO_DELETE_COLUMNS,
  createPhotoDeleteAdminClient,
  deleteOwnedPhoto,
  isPhotoDeleteId,
  isPhotoProcessingActive,
  photoDeleteJson,
  type PhotoDeleteRow,
} from '@/lib/mobile/photo-delete'
import { createMobileSupabaseClient } from '@/lib/mobile/server-client'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; photoId: string }> }

/**
 * Owner deletion of one photo. Bearer-only: a missing or invalid token never
 * falls back to a browser cookie. Ownership of the album and the photo is
 * read with the user's own client under RLS before any service-role work.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createMobileSupabaseClient(req.headers.get('authorization'))
    if (!supabase) return photoDeleteJson({ error: 'Unauthorized' }, 401)

    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user || !isPhotoDeleteId(auth.user.id)) {
      return photoDeleteJson({ error: 'Unauthorized' }, 401)
    }
    const ownerId = auth.user.id

    const { id, photoId } = await params
    if (!isPhotoDeleteId(id) || !isPhotoDeleteId(photoId)) {
      return photoDeleteJson({ error: 'Photo not found' }, 404)
    }
    const albumId = id.toLowerCase()
    const targetPhotoId = photoId.toLowerCase()

    const rate = await rateLimit(req, {
      bucket: 'mobile-photo-delete',
      identifier: ownerId,
      limit: 300,
      windowSeconds: 10 * 60,
    })
    if (!rate.allowed) {
      return photoDeleteJson({ error: 'Too many deletions. Try again shortly.', code: 'RATE_LIMITED' }, 429)
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id')
      .eq('id', albumId)
      .eq('owner_id', ownerId)
      .eq('status', 'active')
      .maybeSingle()
    if (albumError) return photoDeleteJson({ error: 'Unable to delete photo' }, 500)
    if (album?.id !== albumId) return photoDeleteJson({ error: 'Photo not found' }, 404)

    const { data, error: photoError } = await supabase
      .from('photos')
      .select(PHOTO_DELETE_COLUMNS)
      .eq('id', targetPhotoId)
      .eq('album_id', albumId)
      .eq('owner_id', ownerId)
      .maybeSingle()
    if (photoError) return photoDeleteJson({ error: 'Unable to delete photo' }, 500)
    const photo = data as PhotoDeleteRow | null
    // Already gone (for example a retried request whose reply was lost).
    if (!photo || photo.id !== targetPhotoId || photo.owner_id !== ownerId || photo.album_id !== albumId) {
      return photoDeleteJson({ error: 'Photo not found' }, 404)
    }

    if (isPhotoProcessingActive(photo)) {
      return photoDeleteJson(
        { error: 'This photo is still processing. Delete it once it finishes.', code: 'PHOTO_PROCESSING' },
        409
      )
    }

    const admin = createPhotoDeleteAdminClient()
    if (!admin) return photoDeleteJson({ error: 'Unable to delete photo' }, 500)

    const { httpStatus, ...result } = await deleteOwnedPhoto(admin, photo)
    return photoDeleteJson(result, httpStatus)
  } catch {
    // Never expose storage keys, identities or database errors.
    return photoDeleteJson({ error: 'Unable to delete photo' }, 500)
  }
}
