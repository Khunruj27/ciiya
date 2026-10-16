import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  createPhotoReprocessRevision,
  isReprocessableOriginalPath,
  photoReprocessPayload,
} from '@/lib/photo-reprocess'
import { ACTIVE_JOB_STATUSES, RESET_JOB_FIELDS, type PhotoRetryRow } from '@/lib/mobile/photo-retry'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export type PhotoReprocessResult =
  | { success: true; queued: boolean }
  | { error: string; code?: string }

export function photoReprocessJson(body: PhotoReprocessResult, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * A finished photo can be rendered again only from its raw upload: rows whose
 * original was replaced by the baked image would get the preset twice.
 */
export function isPhotoReprocessable(photo: PhotoRetryRow) {
  return (
    photo.processing_status === 'done' &&
    isReprocessableOriginalPath(photo.original_path, photo.owner_id, photo.album_id)
  )
}

async function activeJobExists(admin: SupabaseClient, photoId: string) {
  const { data } = await admin
    .from('photo_jobs')
    .select('id,status')
    .eq('photo_id', photoId)
    .maybeSingle()
  return Boolean(data && ACTIVE_JOB_STATUSES.has(String(data.status)))
}

/**
 * Queues a finished photo to be rendered again with its current preset.
 *
 * The photo row is not touched: it stays `done`, so galleries keep showing
 * the previous render until the worker commits the new one under new keys
 * (the job payload's revision). The one job row a photo may have is reset by
 * compare-and-set on its status, as for a failed-photo retry.
 */
export async function requeueFinishedPhoto(
  admin: SupabaseClient,
  photo: PhotoRetryRow
): Promise<PhotoReprocessResult & { httpStatus: number }> {
  const { data: job, error: jobError } = await admin
    .from('photo_jobs')
    .select('id,status,owner_id,album_id')
    .eq('photo_id', photo.id)
    .maybeSingle()
  if (jobError) return { error: 'Unable to reprocess photo', httpStatus: 500 }

  const payload = photoReprocessPayload(createPhotoReprocessRevision())

  if (job) {
    if (job.owner_id !== photo.owner_id || job.album_id !== photo.album_id) {
      return { error: 'Unable to reprocess photo', httpStatus: 500 }
    }
    if (ACTIVE_JOB_STATUSES.has(String(job.status))) {
      return { success: true, queued: false, httpStatus: 200 }
    }

    const { data: reset, error: resetError } = await admin
      .from('photo_jobs')
      .update({ ...RESET_JOB_FIELDS(), payload })
      .eq('id', job.id)
      .eq('photo_id', photo.id)
      .eq('status', job.status)
      .select('id')
      .maybeSingle()
    if (resetError) return { error: 'Unable to reprocess photo', httpStatus: 500 }
    if (reset?.id !== job.id) {
      // Another request queued it first: the same outcome for the owner.
      if (await activeJobExists(admin, photo.id)) return { success: true, queued: false, httpStatus: 200 }
      return { error: 'Photo processing changed. Refresh and try again.', code: 'RETRY_CONFLICT', httpStatus: 409 }
    }
    return { success: true, queued: true, httpStatus: 200 }
  }

  // Legacy photos without a job row: create the one row the queue allows.
  const { error: insertError } = await admin.from('photo_jobs').insert({
    ...RESET_JOB_FIELDS(),
    photo_id: photo.id,
    owner_id: photo.owner_id,
    album_id: photo.album_id,
    original_path: photo.original_path,
    preset_path: photo.preset_path || null,
    size: ['sd', 'hd', 'uhd', 'original'].includes(String(photo.selected_size)) ? photo.selected_size : 'hd',
    payload,
  })
  if (insertError) {
    if (await activeJobExists(admin, photo.id)) return { success: true, queued: false, httpStatus: 200 }
    return { error: 'Unable to reprocess photo', httpStatus: 500 }
  }
  return { success: true, queued: true, httpStatus: 200 }
}
