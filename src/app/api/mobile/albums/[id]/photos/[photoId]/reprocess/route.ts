import type { NextRequest } from 'next/server'
import {
  isPhotoReprocessable,
  photoReprocessJson,
  requeueFinishedPhoto,
} from '@/lib/mobile/photo-reprocess'
import {
  PHOTO_RETRY_COLUMNS,
  createPhotoRetryAdminClient,
  isPhotoRetryId,
  photoRetrySourcesExist,
  type PhotoRetryRow,
} from '@/lib/mobile/photo-retry'
import { createMobileSupabaseClient } from '@/lib/mobile/server-client'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; photoId: string }> }

/**
 * Owner-requested re-render of one finished photo, for example after the
 * worker's preset handling changed. Bearer-only: a missing or invalid token
 * never falls back to a browser cookie. Ownership is checked with the user's
 * own client under row level security before any service-role work.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createMobileSupabaseClient(req.headers.get('authorization'))
    if (!supabase) return photoReprocessJson({ error: 'Unauthorized' }, 401)

    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user || !isPhotoRetryId(auth.user.id)) {
      return photoReprocessJson({ error: 'Unauthorized' }, 401)
    }
    const ownerId = auth.user.id

    const { id, photoId } = await params
    if (!isPhotoRetryId(id) || !isPhotoRetryId(photoId)) {
      return photoReprocessJson({ error: 'Photo not found' }, 404)
    }
    const albumId = id.toLowerCase()
    const targetPhotoId = photoId.toLowerCase()

    const rate = await rateLimit(req, {
      bucket: 'mobile-photo-reprocess',
      identifier: ownerId,
      limit: 300,
      windowSeconds: 10 * 60,
    })
    if (!rate.allowed) {
      return photoReprocessJson({ error: 'Too many requests. Try again shortly.', code: 'RATE_LIMITED' }, 429)
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id')
      .eq('id', albumId)
      .eq('owner_id', ownerId)
      .eq('status', 'active')
      .maybeSingle()
    if (albumError) return photoReprocessJson({ error: 'Unable to reprocess photo' }, 500)
    if (album?.id !== albumId) return photoReprocessJson({ error: 'Photo not found' }, 404)

    const { data, error: photoError } = await supabase
      .from('photos')
      .select(PHOTO_RETRY_COLUMNS)
      .eq('id', targetPhotoId)
      .eq('album_id', albumId)
      .eq('owner_id', ownerId)
      .maybeSingle()
    if (photoError) return photoReprocessJson({ error: 'Unable to reprocess photo' }, 500)
    const photo = data as PhotoRetryRow | null
    if (!photo || photo.id !== targetPhotoId || photo.owner_id !== ownerId || photo.album_id !== albumId) {
      return photoReprocessJson({ error: 'Photo not found' }, 404)
    }

    const status = String(photo.processing_status || '')
    if (status === 'pending' || status === 'processing') {
      return photoReprocessJson({ success: true, queued: false })
    }
    if (!isPhotoReprocessable(photo)) {
      return photoReprocessJson(
        { error: 'This photo cannot be processed again', code: 'NOT_REPROCESSABLE' },
        409
      )
    }

    const admin = createPhotoRetryAdminClient()
    if (!admin) return photoReprocessJson({ error: 'Unable to reprocess photo' }, 500)

    if (!(await photoRetrySourcesExist(admin, photo))) {
      return photoReprocessJson(
        { error: 'The original file for this photo is no longer available', code: 'SOURCE_MISSING' },
        409
      )
    }

    const { httpStatus, ...result } = await requeueFinishedPhoto(admin, photo)
    return photoReprocessJson(result, httpStatus)
  } catch {
    // Never expose storage keys, identities or database errors.
    return photoReprocessJson({ error: 'Unable to reprocess photo' }, 500)
  }
}
