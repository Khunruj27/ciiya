import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  createStorageRef,
  getStorageAdapter,
  resolvePresetStorageRef,
  type StorageProvider,
} from '@/lib/storage'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

/** Only what the retry decision and source checks need; no URLs or secrets. */
export const PHOTO_RETRY_COLUMNS =
  'id,album_id,owner_id,processing_status,original_path,storage_path,storage_provider,storage_bucket,preset_path,selected_size'

/** A photo the owner may send back to the worker. */
export const RETRYABLE_PHOTO_STATUSES = ['failed', 'cancelled'] as const
/** Job states that mean the worker already has (or is doing) this photo. */
export const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set(['pending', 'processing'])

export type PhotoRetryRow = {
  id: string
  album_id: string
  owner_id: string
  processing_status: string | null
  original_path: string | null
  storage_path: string | null
  storage_provider: string | null
  storage_bucket: string | null
  preset_path: string | null
  selected_size: string | null
}

export type PhotoRetryResult =
  | { success: true; retried: boolean; status: 'pending' | 'processing' }
  | { error: string; code?: string }

export function photoRetryJson(body: PhotoRetryResult, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export function isPhotoRetryId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** Job and photo bookkeeping needs the service role; it never leaves the server. */
export function createPhotoRetryAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function hasUnsafeStoragePath(value: string) {
  const lower = value.toLowerCase()
  return (
    value.includes('..') || value.includes('\\') || value.includes('//') ||
    lower.includes('%2e') || lower.includes('%2f') || lower.includes('%5c')
  )
}

/**
 * The original (and preset, if any) must still exist, or a retry would only fail
 * again. Mirrors the photo worker: the photo row is canonical for provider,
 * bucket and key, and legacy Supabase rows may live in `albums` or `originals`.
 */
export async function photoRetrySourcesExist(admin: SupabaseClient, photo: PhotoRetryRow) {
  const originalPath = photo.original_path || photo.storage_path || ''
  const albumPrefix = `${photo.owner_id}/${photo.album_id}/`
  if (
    !originalPath ||
    hasUnsafeStoragePath(originalPath) ||
    !['original/', 'hd/', 'preview/'].some((folder) => originalPath.startsWith(albumPrefix + folder))
  ) {
    return false
  }

  const provider: StorageProvider = photo.storage_provider === 'r2' ? 'r2' : 'supabase'
  const bucket = photo.storage_bucket?.trim() || null
  if (provider === 'r2' && !bucket) return false
  const buckets = provider === 'r2' ? [bucket!] : bucket ? [bucket] : ['albums', 'originals']
  const adapter = getStorageAdapter(provider, provider === 'supabase' ? { supabase: admin } : {})

  let originalExists = false
  for (const name of buckets) {
    if ((await adapter.objectExists(createStorageRef({ provider, bucket: name, key: originalPath }))).exists) {
      originalExists = true
      break
    }
  }
  if (!originalExists) return false

  if (!photo.preset_path) return true
  if (
    hasUnsafeStoragePath(photo.preset_path) ||
    (!photo.preset_path.startsWith(`${albumPrefix}presets/`) &&
      !photo.preset_path.startsWith(`${photo.owner_id}/presets/`))
  ) {
    return false
  }
  const presetRef = await resolvePresetStorageRef({
    supabase: admin,
    ownerId: photo.owner_id,
    albumId: photo.album_id,
    presetPath: photo.preset_path,
  })
  if (!presetRef) return false
  const presetAdapter = getStorageAdapter(
    presetRef.provider,
    presetRef.provider === 'supabase' ? { supabase: admin } : {}
  )
  return (await presetAdapter.objectExists(presetRef)).exists
}

export const RESET_JOB_FIELDS = () => ({
  status: 'pending',
  progress: 0,
  error: null,
  retry_count: 0,
  retries: 0,
  started_at: null,
  finished_at: null,
  cancelled_at: null,
  worker_id: null,
  claimed_by: null,
  claimed_at: null,
  // Matches the website's manual retry: an owner-requested photo goes first.
  priority: 1,
  updated_at: new Date().toISOString(),
})

/**
 * Puts a failed photo back in the worker's queue.
 *
 * The database allows one job row per photo, so this resets that row (compare-
 * and-set on its current status) instead of inserting a second one. Size,
 * preset and paths are left exactly as the original upload queued them. The
 * photo is marked pending only while it is still failed/cancelled, so a worker
 * that already picked the job up is never overwritten.
 */
export async function requeuePhotoProcessing(
  admin: SupabaseClient,
  photo: PhotoRetryRow
): Promise<PhotoRetryResult & { httpStatus: number }> {
  const { data: job, error: jobError } = await admin
    .from('photo_jobs')
    .select('id,status,owner_id,album_id')
    .eq('photo_id', photo.id)
    .maybeSingle()
  if (jobError) return { error: 'Unable to retry processing', httpStatus: 500 }

  if (job) {
    if (job.owner_id !== photo.owner_id || job.album_id !== photo.album_id) {
      return { error: 'Unable to retry processing', httpStatus: 500 }
    }
    if (ACTIVE_JOB_STATUSES.has(String(job.status))) {
      return { success: true, retried: false, status: job.status === 'processing' ? 'processing' : 'pending', httpStatus: 200 }
    }

    const { data: reset, error: resetError } = await admin
      .from('photo_jobs')
      .update(RESET_JOB_FIELDS())
      .eq('id', job.id)
      .eq('photo_id', photo.id)
      .eq('status', job.status)
      .select('id')
      .maybeSingle()
    if (resetError) return { error: 'Unable to retry processing', httpStatus: 500 }
    if (reset?.id !== job.id) {
      return { error: 'Photo processing changed. Refresh and try again.', code: 'RETRY_CONFLICT', httpStatus: 409 }
    }
  } else {
    // Legacy photos without a job row: create the one row the queue allows.
    const originalPath = photo.original_path || photo.storage_path
    const { error: insertError } = await admin.from('photo_jobs').insert({
      ...RESET_JOB_FIELDS(),
      photo_id: photo.id,
      owner_id: photo.owner_id,
      album_id: photo.album_id,
      original_path: originalPath,
      preset_path: photo.preset_path || null,
      size: ['sd', 'hd', 'uhd', 'original'].includes(String(photo.selected_size)) ? photo.selected_size : 'hd',
      payload: { source: 'mobile-manual-retry' },
    })
    if (insertError) {
      // Another request may have created it first; that is the same outcome.
      const { data: raced } = await admin
        .from('photo_jobs')
        .select('id,status')
        .eq('photo_id', photo.id)
        .maybeSingle()
      if (!raced || !ACTIVE_JOB_STATUSES.has(String(raced.status))) {
        return { error: 'Unable to retry processing', httpStatus: 500 }
      }
    }
  }

  await admin
    .from('photos')
    .update({
      processing_status: 'pending',
      processing_progress: 0,
      face_scan_status: 'pending',
      face_scan_progress: 0,
      face_scan_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photo.id)
    .eq('owner_id', photo.owner_id)
    .in('processing_status', [...RETRYABLE_PHOTO_STATUSES])

  return { success: true, retried: true, status: 'pending', httpStatus: 200 }
}
