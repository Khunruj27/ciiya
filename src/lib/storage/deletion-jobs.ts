import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStorageAdapter } from './index'
import { normalizePhotoStorageProvider } from './photo-download-plan'
import {
  assertOwnedAlbumObjectKey,
  createStorageRef,
  normalizeObjectKey,
} from './paths'
import type {
  DeleteObjectsResult,
  StorageAdapter,
  StorageObjectRef,
  StorageProvider,
} from './types'

const PHOTO_FOLDERS = [
  'original',
  'preview',
  'thumbnail',
  'thumbnails',
  'sd',
  'hd',
  'uhd',
] as const

const ALBUM_FOLDERS = [
  ...PHOTO_FOLDERS,
  'cover',
  'photos',
  'presets',
  'guest-moments',
  'generated-downloads',
] as const
const STAGE_CHUNK_SIZE = 500

export type PhotoDeletionRecord = {
  id: string
  album_id: string
  storage_provider?: unknown
  storage_bucket?: string | null
  storage_path?: string | null
  original_path?: string | null
  preview_path?: string | null
  thumbnail_path?: string | null
  sd_path?: string | null
  hd_path?: string | null
  uhd_path?: string | null
}

export type StorageDeletionTarget = {
  ref: StorageObjectRef
  photoId?: string | null
}

export type StorageDeletionJob = {
  id: string
  operation_id: string
  owner_id: string
  album_id: string | null
  photo_id: string | null
  storage_provider: StorageProvider
  storage_bucket: string
  object_key: string
  retry_count: number
  max_retries: number
}

type AdapterFactory = (
  provider: StorageProvider,
  supabase: SupabaseClient
) => StorageAdapter

function targetIdentity(target: StorageDeletionTarget) {
  const { provider, bucket, key } = target.ref
  return `${provider}\0${bucket}\0${key}`
}

export function dedupeStorageDeletionTargets(
  targets: StorageDeletionTarget[]
) {
  return Array.from(
    new Map(targets.map((target) => [targetIdentity(target), target])).values()
  )
}

export function buildPhotoDeletionTargets(params: {
  photo: PhotoDeletionRecord
  ownerId: string
  albumId: string
}) {
  const { photo, ownerId, albumId } = params
  const provider = normalizePhotoStorageProvider(photo.storage_provider)
  const paths = Array.from(
    new Set(
      [
        photo.storage_path,
        photo.original_path,
        photo.preview_path,
        photo.thumbnail_path,
        photo.sd_path,
        photo.hd_path,
        photo.uhd_path,
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  )
  const targets: StorageDeletionTarget[] = []

  for (const path of paths) {
    const key = assertOwnedAlbumObjectKey(
      path,
      ownerId,
      albumId,
      PHOTO_FOLDERS
    )

    if (provider === 'r2') {
      const bucket = photo.storage_bucket?.trim()

      if (!bucket) {
        throw new Error('R2 photo is missing storage_bucket')
      }

      targets.push({
        ref: createStorageRef({ provider, bucket, key }),
        photoId: photo.id,
      })
      continue
    }

    const buckets = key.includes('/original/')
      ? ['originals', 'albums']
      : ['albums']

    for (const bucket of buckets) {
      targets.push({
        ref: createStorageRef({ provider, bucket, key }),
        photoId: photo.id,
      })
    }
  }

  return dedupeStorageDeletionTargets(targets)
}

export function buildAlbumObjectDeletionTarget(params: {
  provider: StorageProvider
  bucket: string
  key: string
  ownerId: string
  albumId: string
  photoId?: string | null
}) {
  const key = assertOwnedAlbumObjectKey(
    params.key,
    params.ownerId,
    params.albumId,
    ALBUM_FOLDERS
  )

  return {
    ref: createStorageRef({
      provider: params.provider,
      bucket: params.bucket,
      key,
    }),
    photoId: params.photoId ?? null,
  } satisfies StorageDeletionTarget
}

export function buildLegacyGuestMomentDeletionTarget(params: {
  key: string
  albumId: string
}) {
  const key = normalizeObjectKey(params.key)

  if (!key.startsWith(`${params.albumId}/`)) {
    throw new Error('Legacy Guest Moment object does not belong to the album')
  }

  return {
    ref: createStorageRef({
      provider: 'supabase',
      bucket: 'guest-moments',
      key,
    }),
    photoId: null,
  } satisfies StorageDeletionTarget
}

export async function stageStorageDeletionJobs(params: {
  supabase: SupabaseClient
  ownerId: string
  albumId: string
  targets: StorageDeletionTarget[]
}) {
  const targets = dedupeStorageDeletionTargets(params.targets)

  if (targets.length === 0) {
    return { operationId: null, staged: 0 }
  }

  const operationId = randomUUID()
  const now = new Date().toISOString()
  const rows = targets.map(({ ref, photoId }) => ({
    operation_id: operationId,
    owner_id: params.ownerId,
    album_id: params.albumId,
    photo_id: photoId ?? null,
    storage_provider: ref.provider,
    storage_bucket: ref.bucket,
    object_key: ref.key,
    status: 'staged',
    retry_count: 0,
    worker_id: null,
    last_error: null,
    next_retry_at: null,
    started_at: null,
    completed_at: null,
    updated_at: now,
  }))
  for (let index = 0; index < rows.length; index += STAGE_CHUNK_SIZE) {
    const { error } = await params.supabase
      .from('storage_deletion_jobs')
      .upsert(rows.slice(index, index + STAGE_CHUNK_SIZE), {
        onConflict:
          'operation_id,storage_provider,storage_bucket,object_key',
        ignoreDuplicates: true,
      })

    if (error) {
      throw new Error(`Unable to stage storage deletion: ${error.message}`)
    }
  }

  return { operationId, staged: targets.length }
}

export async function activateStorageDeletionOperation(
  supabase: SupabaseClient,
  operationId: string
) {
  const { error } = await supabase
    .from('storage_deletion_jobs')
    .update({
      status: 'pending',
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('operation_id', operationId)
    .eq('status', 'staged')

  if (error) {
    throw new Error(`Unable to activate storage deletion: ${error.message}`)
  }
}

export async function discardStagedStorageDeletionOperation(
  supabase: SupabaseClient,
  operationId: string
) {
  const { error } = await supabase
    .from('storage_deletion_jobs')
    .delete()
    .eq('operation_id', operationId)
    .eq('status', 'staged')

  if (error) {
    console.error(
      '[storage-deletion] unable to discard staged operation:',
      error.message
    )
  }
}

export function storageDeletionRetryDelayMs(retryCount: number) {
  const exponent = Math.max(0, Math.min(12, retryCount))
  return Math.min(24 * 60 * 60 * 1000, 30_000 * 2 ** exponent)
}

export function reconcileStorageDeletionResult(
  jobs: StorageDeletionJob[],
  result: DeleteObjectsResult
) {
  const deleted = new Set(
    result.deleted.map((ref) => `${ref.bucket}\0${ref.key}`)
  )
  const errors = new Map(
    result.failed.map((failure) => [
      `${failure.ref.bucket}\0${failure.ref.key}`,
      failure.error,
    ])
  )
  const completed: StorageDeletionJob[] = []
  const failed: Array<{ job: StorageDeletionJob; error: string }> = []

  for (const job of jobs) {
    const identity = `${job.storage_bucket}\0${job.object_key}`

    if (deleted.has(identity)) {
      completed.push(job)
      continue
    }

    failed.push({
      job,
      error:
        errors.get(identity) ||
        'Storage provider returned no result for this object',
    })
  }

  return { completed, failed }
}

function defaultAdapterFactory(
  provider: StorageProvider,
  supabase: SupabaseClient
) {
  return getStorageAdapter(provider, { supabase })
}

export async function processStorageDeletionJobs(params: {
  supabase: SupabaseClient
  workerId: string
  operationId?: string | null
  limit?: number
  adapterFactory?: AdapterFactory
}) {
  const limit = Math.max(1, Math.min(params.limit ?? 100, 500))
  const { data, error } = await params.supabase.rpc(
    'claim_storage_deletion_jobs',
    {
      p_worker_id: params.workerId,
      p_limit: limit,
      p_operation_id: params.operationId ?? null,
    }
  )

  if (error) {
    throw new Error(`Unable to claim storage deletions: ${error.message}`)
  }

  const jobs = (data || []) as StorageDeletionJob[]
  const adapterFactory = params.adapterFactory ?? defaultAdapterFactory
  const completedIds: string[] = []
  const failures: Array<{ job: StorageDeletionJob; error: string }> = []
  const groups = new Map<StorageProvider, StorageDeletionJob[]>()

  for (const job of jobs) {
    groups.set(job.storage_provider, [
      ...(groups.get(job.storage_provider) || []),
      job,
    ])
  }

  for (const [provider, providerJobs] of groups) {
    try {
      const adapter = adapterFactory(provider, params.supabase)
      const result = await adapter.deleteObjects(
        providerJobs.map((job) =>
          createStorageRef({
            provider,
            bucket: job.storage_bucket,
            key: job.object_key,
          })
        )
      )
      const reconciled = reconcileStorageDeletionResult(providerJobs, result)
      completedIds.push(...reconciled.completed.map((job) => job.id))
      failures.push(...reconciled.failed)
    } catch (adapterError) {
      const message =
        adapterError instanceof Error
          ? adapterError.message
          : 'Storage deletion failed'
      failures.push(
        ...providerJobs.map((job) => ({ job, error: message }))
      )
    }
  }

  if (completedIds.length > 0) {
    const { error: completeError } = await params.supabase
      .from('storage_deletion_jobs')
      .update({
        status: 'completed',
        last_error: null,
        next_retry_at: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', completedIds)
      .eq('worker_id', params.workerId)
      .eq('status', 'processing')

    if (completeError) {
      throw new Error(
        `Unable to complete storage deletions: ${completeError.message}`
      )
    }
  }

  for (const failure of failures) {
    const retryCount = failure.job.retry_count + 1
    const nextRetryAt = new Date(
      Date.now() + storageDeletionRetryDelayMs(retryCount)
    ).toISOString()
    const { error: failureError } = await params.supabase
      .from('storage_deletion_jobs')
      .update({
        status: 'failed',
        retry_count: retryCount,
        last_error: failure.error.slice(0, 2000),
        next_retry_at: nextRetryAt,
        worker_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', failure.job.id)
      .eq('worker_id', params.workerId)
      .eq('status', 'processing')

    if (failureError) {
      console.error(
        '[storage-deletion] unable to persist retry state:',
        failureError.message
      )
    }
  }

  return {
    claimed: jobs.length,
    completed: completedIds.length,
    failed: failures.length,
  }
}

export async function recoverStagedStorageDeletionJobs(
  supabase: SupabaseClient,
  limit = 500
) {
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data, error } = await supabase.rpc(
    'recover_staged_storage_deletion_jobs',
    {
      p_stale_before: staleBefore,
      p_limit: Math.max(1, Math.min(limit, 2000)),
    }
  )

  if (error) {
    throw new Error(`Unable to recover storage deletions: ${error.message}`)
  }

  const result = Array.isArray(data) ? data[0] : data

  return {
    activated: Number(result?.activated || 0),
    discarded: Number(result?.discarded || 0),
    requeued: Number(result?.requeued || 0),
  }
}
