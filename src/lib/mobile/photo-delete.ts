import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  activateStorageDeletionOperation,
  buildPhotoDeletionTargets,
  discardStagedStorageDeletionOperation,
  processStorageDeletionJobs,
  stageStorageDeletionJobs,
} from '@/lib/storage/deletion-jobs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

/** Paths the deletion targets are built from; no URLs or secrets. */
export const PHOTO_DELETE_COLUMNS =
  'id,album_id,owner_id,processing_status,storage_provider,storage_bucket,storage_path,original_path,preview_path,thumbnail_path,sd_path,hd_path,uhd_path'

/**
 * While the worker may still write previews for a photo, deleting it could
 * leave those new objects behind with no row pointing at them. The owner can
 * delete once processing has finished or failed.
 */
const ACTIVE_PROCESSING = new Set(['pending', 'processing', 'uploading', 'finalizing'])

export type PhotoDeleteRow = {
  id: string
  album_id: string
  owner_id: string
  processing_status: string | null
  storage_provider: string | null
  storage_bucket: string | null
  storage_path: string | null
  original_path: string | null
  preview_path: string | null
  thumbnail_path: string | null
  sd_path: string | null
  hd_path: string | null
  uhd_path: string | null
}

export type PhotoDeleteResult =
  | { success: true; cleanupPending: boolean }
  | { error: string; code?: string }

export function photoDeleteJson(body: PhotoDeleteResult, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export function isPhotoDeleteId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function isPhotoProcessingActive(photo: Pick<PhotoDeleteRow, 'processing_status'>) {
  return ACTIVE_PROCESSING.has(String(photo.processing_status || ''))
}

/** Job, RPC and storage bookkeeping needs the service role; it never leaves the server. */
export function createPhotoDeleteAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * Deletes one owned photo exactly as the website's delete route does: stage
 * storage deletion jobs, delete the rows in one locked transaction
 * (`delete_photo_complete`, which also clears it as an album cover), then
 * activate and run the staged jobs. Storage that cannot be removed right away
 * stays queued for the existing retry worker; it is never forgotten.
 */
export async function deleteOwnedPhoto(
  admin: SupabaseClient,
  photo: PhotoDeleteRow
): Promise<PhotoDeleteResult & { httpStatus: number }> {
  let targets: ReturnType<typeof buildPhotoDeletionTargets>
  try {
    targets = buildPhotoDeletionTargets({ photo, ownerId: photo.owner_id, albumId: photo.album_id })
  } catch {
    // A path outside this owner's album folder: refuse rather than guess.
    return { error: 'Photo storage data is invalid', code: 'INVALID_STORAGE', httpStatus: 409 }
  }

  const staged = await stageStorageDeletionJobs({
    supabase: admin,
    ownerId: photo.owner_id,
    albumId: photo.album_id,
    targets,
  })

  const { error: rpcError } = await admin.rpc('delete_photo_complete', {
    target_photo_id: photo.id,
    target_owner_id: photo.owner_id,
  })
  if (rpcError) {
    // Nothing was deleted: drop the staged jobs so no object is removed.
    if (staged.operationId) await discardStagedStorageDeletionOperation(admin, staged.operationId)
    return { error: 'Unable to delete photo', httpStatus: 500 }
  }

  let cleanupPending = false
  if (staged.operationId) {
    try {
      await activateStorageDeletionOperation(admin, staged.operationId)
      const result = await processStorageDeletionJobs({
        supabase: admin,
        workerId: `mobile-photo-delete-${randomUUID()}`,
        operationId: staged.operationId,
        limit: Math.max(1, staged.staged),
      })
      cleanupPending = staged.staged > result.completed
    } catch {
      // The rows are gone and the jobs are activated or staged; the retry
      // worker and staged-job recovery finish the storage cleanup.
      cleanupPending = true
    }
  }

  await admin.rpc('recalculate_user_storage', { user_uuid: photo.owner_id }).then(
    () => undefined,
    () => undefined
  )

  return { success: true, cleanupPending, httpStatus: 200 }
}
