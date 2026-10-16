import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  PHOTO_RETRY_COLUMNS,
  RETRYABLE_PHOTO_STATUSES,
  createPhotoRetryAdminClient,
  photoRetrySourcesExist,
  requeuePhotoProcessing,
  type PhotoRetryRow,
} from '@/lib/mobile/photo-retry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * The album grid's "failed · Try again" button.
 *
 * The database allows one photo_jobs row per photo, so the photo's existing job
 * is reset in place (compare-and-set on its status) by the same helper the
 * mobile app uses. Inserting a second job, as this route used to, always hit
 * that unique index and left the photo failed. Size, preset and paths stay as
 * the upload queued them.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => null)
    const photoId = String(body?.photoId || '').trim().toLowerCase()
    if (!UUID_PATTERN.test(photoId)) return json({ error: 'Invalid photoId' }, 400)

    // Ownership is read with the signed-in user's client under RLS first.
    const { data, error: photoError } = await supabase
      .from('photos')
      .select(PHOTO_RETRY_COLUMNS)
      .eq('id', photoId)
      .eq('owner_id', user.id)
      .maybeSingle()
    if (photoError) return json({ error: 'Unable to retry processing' }, 500)

    const photo = data as PhotoRetryRow | null
    if (!photo || photo.id !== photoId || photo.owner_id !== user.id) {
      return json({ error: 'Photo not found' }, 404)
    }

    const status = String(photo.processing_status || '')
    if (status === 'pending' || status === 'processing') {
      return json({ success: true, retried: false, photoId, status })
    }
    if (!(RETRYABLE_PHOTO_STATUSES as readonly string[]).includes(status)) {
      return json({ error: 'Only failed photos can be processed again', code: 'NOT_RETRYABLE' }, 409)
    }

    const admin = createPhotoRetryAdminClient()
    if (!admin) return json({ error: 'Unable to retry processing' }, 500)

    if (!(await photoRetrySourcesExist(admin, photo))) {
      return json(
        { error: 'The original file for this photo is no longer available', code: 'SOURCE_MISSING' },
        409
      )
    }

    const { httpStatus, ...result } = await requeuePhotoProcessing(admin, photo)
    return json({ ...result, ...('success' in result ? { photoId } : {}) }, httpStatus)
  } catch {
    // Never expose storage keys or database errors.
    return json({ error: 'Unable to retry processing' }, 500)
  }
}
