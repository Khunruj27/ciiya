import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import type { Sharp } from 'sharp'
import WebSocket from 'ws'
import {
  createStorageRef,
  getStorageAdapter,
  resolvePublicStorageUrl,
  resolvePresetStorageRef,
  type StorageAdapter,
  type StorageProvider,
} from '../src/lib/storage'
import {
  buildPhotoWorkerObjectPlan,
  type PhotoWorkerSelectedSize,
} from '../src/lib/storage/photo-worker-plan'

function getSafeIntegerEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const parsedValue = Number(value)

  if (
    !Number.isSafeInteger(parsedValue) ||
    parsedValue < min ||
    parsedValue > max
  ) {
    return fallback
  }

  return parsedValue
}

const SHARP_CONCURRENCY = getSafeIntegerEnv(
  process.env.SHARP_CONCURRENCY,
  1,
  1,
  16
)

const SHARP_CACHE_MEMORY = getSafeIntegerEnv(
  process.env.SHARP_CACHE_MEMORY,
  64,
  0,
  1024
)

const SHARP_CACHE_FILES = getSafeIntegerEnv(
  process.env.SHARP_CACHE_FILES,
  0,
  0,
  1000
)

const SHARP_CACHE_ITEMS = getSafeIntegerEnv(
  process.env.SHARP_CACHE_ITEMS,
  32,
  0,
  1000
)

sharp.concurrency(SHARP_CONCURRENCY)

sharp.cache({
  memory: SHARP_CACHE_MEMORY,
  files: SHARP_CACHE_FILES,
  items: SHARP_CACHE_ITEMS,
})

type SelectedSize = PhotoWorkerSelectedSize

type PhotoJob = {
  id: string
  photo_id: string
  album_id: string
  owner_id: string

  original_path: string
  preset_path?: string | null

  size?: string | null

  retry_count?: number | null
  retries?: number | null
}

type PhotoStorageRecord = {
  id: string
  album_id?: string | null
  owner_id?: string | null
  user_id?: string | null
  original_path?: string | null
  storage_path?: string | null
  storage_provider?: string | null
  storage_bucket?: string | null
  preset_path?: string | null
}

type PhotoStorageContext = {
  provider: StorageProvider
  bucket: string | null
  originalPath: string
  presetPath: string | null
}

type XmpAdjustments = {
  exposure: number
  contrast: number
  saturation: number
  vibrance: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temperature: number
  tint: number
  grayscale: boolean
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const POLL_INTERVAL = getSafeIntegerEnv(
  process.env.WORKER_POLL_INTERVAL,
  2000,
  250,
  60_000
)

const WORKER_LIMIT = getSafeIntegerEnv(
  process.env.WORKER_LIMIT,
  2,
  1,
  32
)

const FACE_SCAN_ENABLED =
  process.env.FACE_SCAN_ENABLED !== 'false'

const MAX_CLAIM_BATCH = getSafeIntegerEnv(
  process.env.PHOTO_JOB_CLAIM_BATCH,
  4,
  1,
  100
)

const MAX_PER_ALBUM = getSafeIntegerEnv(
  process.env.PHOTO_JOB_MAX_PER_ALBUM,
  1,
  1,
  100
)

// Prefer a stable per-replica id so restarts reuse the same heartbeat row
// (upsert on worker_id) instead of leaking a new PID row on every crash-restart.
// Railway sets RAILWAY_REPLICA_ID per running replica; fall back to pid locally.
const WORKER_ID = `photo-worker-${
  process.env.RAILWAY_REPLICA_ID || process.pid
}`

let lastHeartbeatAt = 0
let lastRecoverAt = 0
let lastMetricsAt = 0
let processedJobsCount = 0
let failedJobsCount = 0
let totalProcessingMs = 0
let isShuttingDown = false
let activeJobsCount = 0

const wakeSleepers = new Set<() => void>()

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    transport: WebSocket as unknown as typeof globalThis.WebSocket,
  },
})

const storageAdapters = new Map<StorageProvider, StorageAdapter>()

function getWorkerStorageAdapter(provider: StorageProvider) {
  const existing = storageAdapters.get(provider)

  if (existing) return existing

  const adapter = getStorageAdapter(
    provider,
    provider === 'supabase' ? { supabase } : {}
  )

  storageAdapters.set(provider, adapter)
  return adapter
}

const presetCache = new Map<string, XmpAdjustments | null>()

function setPresetCache(key: string, value: XmpAdjustments | null) {
  presetCache.set(key, value)

  if (presetCache.size > 200) {
    const firstKey = presetCache.keys().next().value

    if (firstKey) {
      presetCache.delete(firstKey)
    }
  }
}

console.log('[PhotoWorker] started')
console.log('[PhotoWorker] FACE_SCAN_ENABLED =', FACE_SCAN_ENABLED)

process.on('SIGTERM', () => requestShutdown('SIGTERM'))
process.on('SIGINT', () => requestShutdown('SIGINT'))

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    let settled = false

    const finish = () => {
      if (settled) return

      settled = true
      clearTimeout(timer)
      wakeSleepers.delete(finish)
      resolve()
    }

    const timer = setTimeout(finish, ms)

    wakeSleepers.add(finish)
  })
}

function requestShutdown(signal: string) {
  if (isShuttingDown) return

  isShuttingDown = true

  console.log(
    `[PhotoWorker] received ${signal}, waiting for ${activeJobsCount} active job(s)`
  )

  for (const wake of [...wakeSleepers]) {
    wake()
  }
}

type SupabaseResultLike = {
  error?: {
    message?: string
  } | null
}

function hasSupabaseError(value: unknown): value is SupabaseResultLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    Boolean((value as SupabaseResultLike).error)
  )
}

async function withRetry<T>(
  fn: () => PromiseLike<T>,
  retries = 5,
  baseDelay = 1200,
  options: { allowDuringShutdown?: boolean } = {}
): Promise<T> {
  let lastError: unknown
  const allowDuringShutdown = options.allowDuringShutdown === true

  for (
    let attempt = 1;
    attempt <= retries;
    attempt += 1
  ) {
    if (isShuttingDown && !allowDuringShutdown) {
      throw new Error('Worker is shutting down')
    }

    try {
      const result = await fn()

      if (hasSupabaseError(result)) {
        throw new Error(
          result.error?.message ||
            'Supabase operation failed'
        )
      }

      return result
    } catch (error) {
      lastError = error

      console.error(
        `[PhotoWorker] retry ${attempt}/${retries} failed:`,
        error instanceof Error
          ? error.message
          : error
      )

      if (
        attempt < retries &&
        (!isShuttingDown || allowDuringShutdown)
      ) {
        await sleep(baseDelay * attempt)
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        'Operation failed after retries'
      )
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function hasUnsafeStoragePath(path: string) {
  const lowerPath = path.toLowerCase()

  return (
    path.includes('..') ||
    path.includes('\\') ||
    path.includes('//') ||
    lowerPath.includes('%2e') ||
    lowerPath.includes('%2f') ||
    lowerPath.includes('%5c')
  )
}

function getXmpNumber(xmp: string, key: string) {
  const patterns = [
    new RegExp(`${key}="([^"]+)"`),
    new RegExp(`crs:${key}="([^"]+)"`),
  ]

  for (const pattern of patterns) {
    const match = xmp.match(pattern)

    if (match?.[1]) {
      const value = Number(match[1])
      if (Number.isFinite(value)) return value
    }
  }

  return 0
}

async function loadXmpAdjustments(
  presetPath: string | null | undefined,
  ownerId: string,
  albumId: string
): Promise<XmpAdjustments | null> {
  if (!presetPath) return null

  const cacheKey = `${ownerId}:${presetPath}`

  if (presetCache.has(cacheKey)) {
    return presetCache.get(cacheKey) || null
  }

  try {
    const ref = await resolvePresetStorageRef({
      supabase,
      ownerId,
      albumId,
      presetPath,
    })

    if (!ref) {
      console.warn('[PhotoWorker] preset storage reference not found')
      setPresetCache(cacheKey, null)
      return null
    }

    const buffer = await withRetry(() =>
      getWorkerStorageAdapter(ref.provider).downloadObject(ref)
    )
    const xmp = buffer.toString('utf-8')

const preset: XmpAdjustments = {
  exposure: getXmpNumber(xmp, 'Exposure2012'),
  contrast: getXmpNumber(xmp, 'Contrast2012'),
  saturation: getXmpNumber(xmp, 'Saturation'),
  vibrance: getXmpNumber(xmp, 'Vibrance'),
  highlights: getXmpNumber(xmp, 'Highlights2012'),
  shadows: getXmpNumber(xmp, 'Shadows2012'),
  whites: getXmpNumber(xmp, 'Whites2012'),
  blacks: getXmpNumber(xmp, 'Blacks2012'),
  temperature: getXmpNumber(xmp, 'Temperature'),
  tint: getXmpNumber(xmp, 'Tint'),
  grayscale: getXmpBoolean(xmp, 'ConvertToGrayscale'),
}

    console.log('[PhotoWorker] loaded xmp:', preset)

    setPresetCache(cacheKey, preset)

    return preset
  } catch (error) {
    console.error('[PhotoWorker] xmp parse failed:', error)
    setPresetCache(cacheKey, null)
    return null
  }
}

function getXmpBoolean(xmp: string, key: string) {
  const patterns = [
    new RegExp(`${key}="([^"]+)"`),
    new RegExp(`crs:${key}="([^"]+)"`),
  ]

  for (const pattern of patterns) {
    const match = xmp.match(pattern)

    if (match?.[1]) {
      return match[1] === 'True' || match[1] === 'true'
    }
  }

  return false
}

function applyXmpAdjustments(image: Sharp, preset: XmpAdjustments | null) {
  if (!preset) return image

  const brightness = clamp(
    1 +
      preset.exposure * 0.2 +
      preset.whites * 0.0015 -
      preset.blacks * 0.001,
    0.55,
    1.75
  )

  const saturation = preset.grayscale
    ? 0
    : clamp(
        1 +
          preset.saturation * 0.006 +
          preset.vibrance * 0.005 +
          Math.abs(preset.temperature) * 0.0006,
        0.15,
        2.25
      )

  const contrast = clamp(
    1 +
      preset.contrast * 0.005 +
      preset.highlights * 0.001 -
      preset.shadows * 0.001,
    0.65,
    1.85
  )

  const gamma = clamp(
    1 - preset.shadows * 0.0015 + preset.highlights * 0.001,
    0.75,
    1.35
  )

  let output = image
    .modulate({
      brightness,
      saturation,
    })
    .linear(contrast, 128 - 128 * contrast)
    .gamma(clamp(gamma, 1, 3))

  if (preset.temperature || preset.tint) {
    const red = clamp(1 + preset.temperature * 0.0012, 0.85, 1.18)
    const blue = clamp(1 - preset.temperature * 0.0012, 0.85, 1.18)
    const green = clamp(1 + preset.tint * 0.001, 0.9, 1.12)

    output = output.recomb([
      [red, 0, 0],
      [0, green, 0],
      [0, 0, blue],
    ])
  }

  return output
}

function normalizeSelectedSize(size: string): SelectedSize {
  if (size === 'sd') return 'sd'
  if (size === 'uhd') return 'uhd'
  if (size === 'original') return 'original'
  return 'hd'
}

function getWidthBySize(size: SelectedSize) {
  if (size === 'sd') return 2000
  if (size === 'uhd') return 4000
  return 3000
}

function contentTypeForStoragePath(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff'
  return 'image/jpeg'
}

function normalizeStorageProvider(value: unknown): StorageProvider {
  if (value == null || value === '') return 'supabase'
  if (value === 'supabase' || value === 'r2') return value

  throw new Error(`Unsupported photo storage provider: ${String(value)}`)
}

async function getPhotoStorageContext(
  job: PhotoJob
): Promise<PhotoStorageContext> {
  const result = await withRetry(() =>
    supabase
      .from('photos')
      .select('*')
      .eq('id', String(job.photo_id))
      .maybeSingle()
  )
  const photo = result.data as PhotoStorageRecord | null

  if (!photo) {
    throw new Error('Photo record not found')
  }

  const ownerId = String(photo.owner_id || photo.user_id || '')
  const albumId = String(photo.album_id || '')

  if (ownerId !== String(job.owner_id) || albumId !== String(job.album_id)) {
    throw new Error('Photo job owner or album does not match the photo record')
  }

  const provider = normalizeStorageProvider(photo.storage_provider)
  const bucket = photo.storage_bucket?.trim() || null

  if (provider === 'r2' && !bucket) {
    throw new Error('R2 photo is missing storage_bucket')
  }

  return {
    provider,
    bucket,
    originalPath: String(photo.original_path || job.original_path || ''),
    presetPath:
      photo.preset_path != null
        ? String(photo.preset_path)
        : job.preset_path != null
          ? String(job.preset_path)
          : null,
  }
}

async function downloadPhotoOriginal(context: PhotoStorageContext) {
  const adapter = getWorkerStorageAdapter(context.provider)
  const buckets =
    context.provider === 'r2'
      ? [context.bucket!]
      : context.bucket
        ? [context.bucket]
        : ['albums', 'originals']

  for (const bucket of buckets) {
    const ref = createStorageRef({
      provider: context.provider,
      bucket,
      key: context.originalPath,
    })
    const head = await withRetry(() => adapter.objectExists(ref))

    if (head.exists) {
      return withRetry(() => adapter.downloadObject(ref))
    }
  }

  throw new Error(`Cannot find original object: ${context.originalPath}`)
}

async function uploadPhotoObject(params: {
  provider: StorageProvider
  bucket: string
  key: string
  body: Buffer
}) {
  const adapter = getWorkerStorageAdapter(params.provider)
  const ref = createStorageRef({
    provider: params.provider,
    bucket: params.bucket,
    key: params.key,
  })

  return withRetry(() =>
    adapter.uploadObject(ref, params.body, {
      contentType: contentTypeForStoragePath(params.key),
      cacheControl: 'no-store',
      upsert: true,
    })
  )
}

function getPhotoPublicUrl(params: {
  provider: StorageProvider
  bucket: string
  key: string
}) {
  const url = resolvePublicStorageUrl(params)

  if (!url) {
    throw new Error(
      `${params.provider} public preview delivery is not configured`
    )
  }

  return url
}

async function updatePhoto(
  photoId: string,
  payload: Record<string, unknown>
) {
  await withRetry(() =>
    supabase
      .from('photos')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', photoId)
  )
}

function getMemoryMb() {
  return Math.round(process.memoryUsage().rss / 1024 / 1024)
}

async function sendWorkerMetrics() {
  const totalJobs =
    processedJobsCount + failedJobsCount

  const avgProcessingMs =
    totalJobs > 0
      ? Math.round(
          totalProcessingMs / totalJobs
        )
      : 0

  try {
    await withRetry(() =>
      supabase
        .from('worker_metrics')
        .insert({
          worker_id: WORKER_ID,
          worker_name: WORKER_ID,
          worker_type: 'photo',
          status: 'online',
          processed_jobs:
            processedJobsCount,
          failed_jobs: failedJobsCount,
          avg_processing_ms:
            avgProcessingMs,
          memory_mb: getMemoryMb(),
          metadata: {
            pid: process.pid,
            workerLimit: WORKER_LIMIT,
            maxClaimBatch:
              MAX_CLAIM_BATCH,
            maxPerAlbum:
              MAX_PER_ALBUM,
            faceScanEnabled:
              FACE_SCAN_ENABLED,
          },
          recorded_at:
            new Date().toISOString(),
        })
    )
  } catch (error) {
    console.error(
      '[PhotoWorker] metrics failed:',
      error instanceof Error
        ? error.message
        : error
    )
  }
}

async function sendHeartbeat() {
  try {
    await withRetry(() =>
      supabase
        .from('worker_heartbeats')
        .upsert(
          {
            worker_id: WORKER_ID,
            worker_name: WORKER_ID,
            worker_type: 'photo',
            status: 'online',
            last_seen:
              new Date().toISOString(),
            last_seen_at:
              new Date().toISOString(),
            metadata: {
              pid: process.pid,
              node: process.version,
              workerLimit: WORKER_LIMIT,
              maxClaimBatch:
                MAX_CLAIM_BATCH,
              maxPerAlbum:
                MAX_PER_ALBUM,
              faceScanEnabled:
                FACE_SCAN_ENABLED,
            },
          },
          {
            onConflict: 'worker_id',
          }
        )
    )
  } catch (error) {
    console.error(
      '[PhotoWorker] heartbeat failed:',
      error instanceof Error
        ? error.message
        : error
    )
  }
}

async function markWorkerOffline() {
  const workerId = WORKER_ID

  try {
    const result = await withRetry(
      () =>
        supabase
          .from('worker_heartbeats')
          .update({
            status: 'offline',
            last_seen: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          })
          .eq('worker_id', workerId),
      3,
      300,
      { allowDuringShutdown: true }
    )

    if (result.error) {
      console.error(
        '[PhotoWorker] mark offline failed:',
        result.error.message
      )
    }
  } catch (error) {
    console.error(
      '[PhotoWorker] mark offline error:',
      error instanceof Error ? error.message : error
    )
  }
}

// PID-based rows from older builds (and any crash-restart that skipped the
// graceful offline mark) linger as "online" forever. Nothing else prunes them,
// so each worker clears rows untouched for over a day on startup.
async function pruneStaleHeartbeats() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  try {
    const result = await withRetry(() =>
      supabase
        .from('worker_heartbeats')
        .delete()
        .lt('last_seen_at', cutoff)
        .neq('worker_id', WORKER_ID)
    )

    if (result.error) {
      console.error(
        '[PhotoWorker] prune heartbeats failed:',
        result.error.message
      )
    }
  } catch (error) {
    console.error(
      '[PhotoWorker] prune heartbeats error:',
      error instanceof Error ? error.message : error
    )
  }
}

async function recoverStaleJobs() {
  const staleSince = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  // A job "processing" past the stale window is only orphaned if the worker
  // that claimed it is no longer beating. Excluding live workers means a job
  // that legitimately runs longer than the window is never yanked away from
  // the worker still processing it (which would cause duplicate processing).
  const liveSince = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  const liveResult = await withRetry(() =>
    supabase
      .from('worker_heartbeats')
      .select('worker_id')
      .gte('last_seen_at', liveSince)
  )

  if (liveResult.error) {
    console.error(
      '[PhotoWorker] recover stale (live lookup) failed:',
      liveResult.error.message
    )
  }

  const liveWorkerIds = (liveResult.data || [])
    .map((row) => row.worker_id)
    .filter((id): id is string => Boolean(id))

  let query = supabase
    .from('photo_jobs')
    .update({
  status: 'pending',
  progress: 0,
  error: 'Recovered stale processing job',
  started_at: null,
  finished_at: null,

  worker_id: null,
  claimed_by: null,

  updated_at: new Date().toISOString(),
})
      .eq('status', 'processing')
      .lt('started_at', staleSince)

  if (liveWorkerIds.length > 0) {
    query = query.or(
      `worker_id.is.null,worker_id.not.in.(${liveWorkerIds.join(',')})`
    )
  }

  const result = await withRetry(() => query)

  if (result.error) {
    console.error('[PhotoWorker] recover stale failed:', result.error.message)
  }
}

async function generateBlurDataUrl(buffer: Buffer) {
  const tiny = await sharp(buffer)
    .rotate()
    .resize(20, 20, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 40,
      mozjpeg: true,
    })
    .toBuffer()

  try {
    return `data:image/jpeg;base64,${tiny.toString('base64')}`
  } finally {
    tiny.fill(0)
  }
}

async function generateResizeBuffer(
  buffer: Buffer,
  width: number,
  quality = 86,
  preset: XmpAdjustments | null = null
) {
  const image = sharp(buffer).rotate()

  return applyXmpAdjustments(image, preset)
    .resize({
      width,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality,
      mozjpeg: true,
    })
    .toBuffer()
}

async function generateOriginalProcessedBuffer(
  buffer: Buffer,
  quality = 90,
  preset: XmpAdjustments | null = null
) {
  const image = sharp(buffer).rotate()

  return applyXmpAdjustments(image, preset)
    .jpeg({
      quality,
      mozjpeg: true,
    })
    .toBuffer()
}

async function queueFaceJob(params: {
  job: PhotoJob
  imagePath: string
  imageUrl: string
  storageProvider: StorageProvider
  storageBucket: string
}) {
  const {
    job,
    imagePath,
    imageUrl,
    storageProvider,
    storageBucket,
  } = params

  const photoId = String(job.photo_id)
  const albumId = String(job.album_id)
  const ownerId = String(job.owner_id)

  if (!FACE_SCAN_ENABLED) {
    try {
      await updatePhoto(photoId, {
        face_scan_status: 'skipped',
        face_scan_progress: 100,
        face_scan_error:
          'FACE_SCAN_ENABLED is false',
        faces_count: 0,
      })
    } catch (error) {
      console.error(
        '[PhotoWorker] mark face scan skipped failed:',
        error instanceof Error
          ? error.message
          : error
      )
    }

    return
  }

  try {
    const existingResult = await withRetry(() =>
      supabase
        .from('face_jobs')
        .select('id,status')
        .eq('photo_id', photoId)
        .maybeSingle()
    )

    const existingJob = existingResult.data

    if (existingJob) {
      if (
        existingJob.status === 'failed' ||
        existingJob.status === 'cancelled'
      ) {
        const resetResult = await withRetry(() =>
          supabase
            .from('face_jobs')
            .update({
              album_id: albumId,
              owner_id: ownerId,
              image_path: imagePath,
              image_url: imageUrl,
              status: 'pending',
              progress: 0,
              priority: 100,
              retry_count: 0,
              retries: 0,
              error: null,
              started_at: null,
              finished_at: null,
              worker_id: null,
              claimed_by: null,
              payload: {
                source: 'photo-worker',
                photoId,
                albumId,
                storageProvider,
                storageBucket,
              },
              updated_at:
                new Date().toISOString(),
            })
            .eq('id', existingJob.id)
            .in('status', [
              'failed',
              'cancelled',
            ])
            .select('id,status')
            .maybeSingle()
        )

        if (resetResult.data) {
          await updatePhoto(photoId, {
            face_scan_status: 'pending',
            face_scan_progress: 0,
            face_scan_error: null,
            faces_count: 0,
          })

          return
        }

        const currentResult = await withRetry(() =>
          supabase
            .from('face_jobs')
            .select('id,status')
            .eq('photo_id', photoId)
            .maybeSingle()
        )

        if (currentResult.data) {
          await updatePhoto(photoId, {
            face_scan_status:
              currentResult.data.status === 'done'
                ? 'done'
                : 'pending',
            face_scan_progress:
              currentResult.data.status === 'done'
                ? 100
                : 0,
            face_scan_error: null,
          })

          return
        }
      } else {
        await updatePhoto(photoId, {
          face_scan_status:
            existingJob.status === 'done'
              ? 'done'
              : 'pending',
          face_scan_progress:
            existingJob.status === 'done'
              ? 100
              : 0,
          face_scan_error: null,
        })

        return
      }
    }

    try {
      await withRetry(() =>
        supabase
          .from('face_jobs')
          .insert({
            photo_id: photoId,
            album_id: albumId,
            owner_id: ownerId,
            image_path: imagePath,
            image_url: imageUrl,
            status: 'pending',
            progress: 0,
            priority: 100,
            retry_count: 0,
            retries: 0,
            error: null,
            started_at: null,
            finished_at: null,
            worker_id: null,
            claimed_by: null,
            payload: {
              source: 'photo-worker',
              photoId,
              albumId,
              storageProvider,
              storageBucket,
            },
            updated_at:
              new Date().toISOString(),
          })
          .select('id,status')
          .single()
      )
    } catch (insertError) {
      /*
       * Insert อาจสำเร็จแต่ response หลุด หรือมี Worker
       * อื่นสร้าง Job พร้อมกัน จึงตรวจซ้ำก่อนถือว่าล้มเหลว
       */
      const concurrentResult =
        await withRetry(() =>
          supabase
            .from('face_jobs')
            .select('id,status')
            .eq('photo_id', photoId)
            .maybeSingle()
        )

      if (!concurrentResult.data) {
        throw insertError
      }
    }

    await updatePhoto(photoId, {
      face_scan_status: 'pending',
      face_scan_progress: 0,
      face_scan_error: null,
      faces_count: 0,
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to queue face job'

    console.error(
      '[PhotoWorker] queue face job failed:',
      message
    )

    try {
      await updatePhoto(photoId, {
        face_scan_status: 'failed',
        face_scan_progress: 100,
        face_scan_error: message,
      })
    } catch (updateError) {
      console.error(
        '[PhotoWorker] mark face scan failed error:',
        updateError instanceof Error
          ? updateError.message
          : updateError
      )
    }
  }
}

async function isJobStillOwned(
  job: PhotoJob
) {
  const result = await withRetry(() =>
    supabase
      .from('photo_jobs')
      .select('id,status,worker_id,claimed_by')
      .eq('id', String(job.id))
      .maybeSingle()
  )

  const currentJob = result.data

  if (!currentJob) {
    return false
  }

  return (
    currentJob.status === 'processing' &&
    currentJob.worker_id === WORKER_ID &&
    currentJob.claimed_by === WORKER_ID
  )
}

async function markJobDone(
  job: PhotoJob
) {
  const result = await withRetry(() =>
    supabase
      .from('photo_jobs')
      .update({
        status: 'done',
        progress: 100,
        finished_at: new Date().toISOString(),
        error: null,
        worker_id: null,
        claimed_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', String(job.id))
      .eq('status', 'processing')
      .eq('worker_id', WORKER_ID)
      .eq('claimed_by', WORKER_ID)
      .select('id')
      .maybeSingle()
  )

  if (!result.data) {
    console.warn(
      '[PhotoWorker] mark done skipped because claim ownership was lost:',
      job.id
    )

    return false
  }

  return true
}

function isTransientError(message: string) {
  const text = message.toLowerCase()

  return (
    text.includes('fetch failed') ||
    text.includes('timeout') ||
    text.includes('network') ||
    text.includes('und_err') ||
    text.includes('econnreset') ||
    text.includes('socket') ||
    text.includes('connection')
  )
}

async function markJobFailedOrRetry(
  job: PhotoJob,
  message: string
) {
  const retryCount = Number(
    job.retry_count ||
    job.retries ||
    0
  )

  const maxRetries = isTransientError(message)
    ? 8
    : 3

  const shouldRetry =
    retryCount < maxRetries

  const nextStatus = shouldRetry
    ? 'pending'
    : 'failed'

  const result = await withRetry(() =>
    supabase
      .from('photo_jobs')
      .update({
        status: nextStatus,
        progress: 0,
        retry_count: retryCount + 1,
        retries: retryCount + 1,
        error: message,
        started_at: null,
        finished_at: shouldRetry
          ? null
          : new Date().toISOString(),
        worker_id: null,
        claimed_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', String(job.id))
      .eq('status', 'processing')
      .eq('worker_id', WORKER_ID)
      .eq('claimed_by', WORKER_ID)
      .select('id')
      .maybeSingle()
  )

  if (!result.data) {
    console.warn(
      '[PhotoWorker] retry/failure update skipped because claim ownership was lost:',
      job.id
    )

    return false
  }

  if (job.photo_id) {
    await updatePhoto(
      String(job.photo_id),
      {
        processing_status: nextStatus,
        processing_progress:
          shouldRetry ? 10 : 100,
      }
    )
  }

  return true
}

async function processPhotoJob(job: PhotoJob) {
  activeJobsCount += 1

  const jobBuffers = new Set<Buffer>()

  try {
    console.log('[PhotoWorker] processing:', job.id)
    const startedAt = Date.now()

    if (!job.photo_id) throw new Error('Missing photo_id')

    const storageContext = await getPhotoStorageContext(job)
    const originalPath = storageContext.originalPath
    const presetPath = storageContext.presetPath
    const allowedPrefix = `${job.owner_id}/${job.album_id}/`

    if (
      !originalPath ||
      hasUnsafeStoragePath(originalPath) ||
      !originalPath.startsWith(`${allowedPrefix}original/`)
    ) {
      throw new Error('Invalid original_path')
    }

    const allowedAlbumPresetPrefix = `${allowedPrefix}presets/`
    const allowedUserPresetPrefix = `${job.owner_id}/presets/`

    if (
      presetPath &&
      (hasUnsafeStoragePath(presetPath) ||
        (!presetPath.startsWith(allowedAlbumPresetPrefix) &&
          !presetPath.startsWith(allowedUserPresetPrefix)))
    ) {
      throw new Error('Invalid preset_path')
    }

    await updatePhoto(String(job.photo_id), {
      processing_status: 'processing',
      processing_progress: 10,
    })

    // The photo row is canonical for provider, bucket, and path. This prevents
    // stale or forged queue payloads from redirecting a worker to another
    // owner's object. Preset metadata resolves its provider independently so
    // legacy Supabase and new R2 jobs can share the same queue.
    const [originalBuffer, xmpPreset] = await Promise.all([
      downloadPhotoOriginal(storageContext),
      loadXmpAdjustments(presetPath, String(job.owner_id), String(job.album_id)),
    ])

    jobBuffers.add(originalBuffer)

    console.log('[PhotoWorker] preset path:', presetPath)
    console.log('[PhotoWorker] storage provider:', storageContext.provider)

    const selectedSize = normalizeSelectedSize(
      String(job.size || 'hd').toLowerCase()
    )
    const objectPlan = buildPhotoWorkerObjectPlan({
      provider: storageContext.provider,
      originalKey: originalPath,
      selectedSize,
      hasPreset: Boolean(xmpPreset),
    })
    const previewPath = objectPlan.previewKey
    const thumbnailPath = objectPlan.thumbnailKey
    const outputBucket =
      storageContext.provider === 'r2' ? storageContext.bucket! : 'albums'
    const previewWidth =
      storageContext.provider === 'r2'
        ? getWidthBySize('hd')
        : getWidthBySize(selectedSize)

    // R2 keeps a dedicated, CDN-deliverable preview even when customers may
    // download the private original. Supabase retains its legacy behavior.
    const [previewBuffer, thumbnailBuffer] = await Promise.all([
      storageContext.provider === 'r2'
        ? generateResizeBuffer(originalBuffer, previewWidth, 86, xmpPreset)
        : selectedSize === 'original' && xmpPreset
          ? generateOriginalProcessedBuffer(originalBuffer, 90, xmpPreset)
          : selectedSize === 'original'
            ? Promise.resolve(originalBuffer)
            : generateResizeBuffer(originalBuffer, previewWidth, 86, xmpPreset),
      applyXmpAdjustments(sharp(originalBuffer).rotate(), xmpPreset)
        .resize(480, 480, {
          fit: 'cover',
        })
        .jpeg({
          quality: 76,
          mozjpeg: true,
        })
        .toBuffer(),
    ])

    jobBuffers.add(previewBuffer)
    jobBuffers.add(thumbnailBuffer)

    let selectedDerivativeBuffer: Buffer | null = null

    if (objectPlan.selectedDerivativeKey) {
      selectedDerivativeBuffer =
        selectedSize === 'hd'
          ? previewBuffer
          : await generateResizeBuffer(
              originalBuffer,
              getWidthBySize(selectedSize),
              86,
              xmpPreset
            )
      jobBuffers.add(selectedDerivativeBuffer)
    }

    const blurSourceBufferPromise =
      storageContext.provider === 'r2' || selectedSize !== 'original'
        ? Promise.resolve(previewBuffer)
        : applyXmpAdjustments(sharp(originalBuffer).rotate(), xmpPreset)
            .jpeg({
              quality: 60,
              mozjpeg: true,
            })
            .toBuffer()

    const uploadTasks = [
      uploadPhotoObject({
        provider: storageContext.provider,
        bucket: outputBucket,
        key: thumbnailPath,
        body: thumbnailBuffer,
      }),
    ]

    if (objectPlan.shouldUploadPreview) {
      uploadTasks.push(
        uploadPhotoObject({
          provider: storageContext.provider,
          bucket: outputBucket,
          key: previewPath,
          body: previewBuffer,
        })
      )
    }

    if (objectPlan.selectedDerivativeKey && selectedDerivativeBuffer) {
      uploadTasks.push(
        uploadPhotoObject({
          provider: storageContext.provider,
          bucket: outputBucket,
          key: objectPlan.selectedDerivativeKey,
          body: selectedDerivativeBuffer,
        })
      )
    }

    await Promise.all(uploadTasks)

    // Relocate the full-resolution original into the private `originals`
    // bucket so a leaked public URL can never expose it. Skip when the
    // delivered size IS the original — then the original file is also the
    // client-facing display image and must stay in the public bucket — or if
    // the preview already points at the original path for any reason. Runs
    // before the final commit so a failure retries the whole job with the
    // original still intact in `albums`.
    const originalWasRelocated =
      objectPlan.shouldRelocateSupabaseOriginal

    // `original`-size delivery with a preset: the baked full-res now lives at a
    // distinct `preview/` path and is the client-facing deliverable, so the raw
    // `original/` upload is superseded (it was overwritten before this fix, so
    // nothing new is lost by removing it) and its public copy can go.
    const processedOriginalReplacesRaw =
      objectPlan.shouldReplaceSupabaseRawOriginal

    if (originalWasRelocated) {
      await uploadPhotoObject({
        provider: 'supabase',
        bucket: 'originals',
        key: originalPath,
        body: originalBuffer,
      })

      // Best-effort: the file is now safely private; if the public copy
      // lingers, storage cleanup or a later reprocess removes it.
      try {
        await getWorkerStorageAdapter('supabase').deleteObject(
          createStorageRef({
            provider: 'supabase',
            bucket: 'albums',
            key: originalPath,
          })
        )
      } catch (error) {
        console.warn(
          '[PhotoWorker] original public copy not removed:',
          error instanceof Error ? error.message : error
        )
      }
    } else if (processedOriginalReplacesRaw) {
      try {
        await getWorkerStorageAdapter('supabase').deleteObject(
          createStorageRef({
            provider: 'supabase',
            bucket: 'albums',
            key: originalPath,
          })
        )
      } catch (error) {
        console.warn(
          '[PhotoWorker] raw original copy not removed:',
          error instanceof Error ? error.message : error
        )
      }
    }

    await updatePhoto(String(job.photo_id), {
      processing_progress: 60,
    })

    const previewUrl = getPhotoPublicUrl({
      provider: storageContext.provider,
      bucket: outputBucket,
      key: previewPath,
    })
    const thumbnailUrl = getPhotoPublicUrl({
      provider: storageContext.provider,
      bucket: outputBucket,
      key: thumbnailPath,
    })

    const blurSourceBuffer = await blurSourceBufferPromise

    jobBuffers.add(blurSourceBuffer)

    const blurDataUrl = await generateBlurDataUrl(blurSourceBuffer)

    // Only the size the user actually picked gets generated up front —
    // an sd/uhd selection no longer also forces a full extra 3000px
    // pass. hd_url/hd_path stay null in that case; downloading an HD
    // copy still works, /api/photos/download generates and caches it
    // lazily on request instead of eagerly for every photo.
    let hdPath: string | null = null
    let hdUrl: string | null = null
    let sdPath: string | null = null
    const sdUrl: string | null = null
    let uhdPath: string | null = null
    const uhdUrl: string | null = null

    if (storageContext.provider === 'r2') {
      if (selectedSize === 'sd') sdPath = objectPlan.selectedDerivativeKey
      if (selectedSize === 'hd') hdPath = objectPlan.selectedDerivativeKey
      if (selectedSize === 'uhd') uhdPath = objectPlan.selectedDerivativeKey
    } else if (selectedSize === 'hd') {
      hdPath = previewPath
      hdUrl = previewUrl
    }

    const stillOwnsJob = await isJobStillOwned(job)

if (!stillOwnsJob) {
  console.warn(
    '[PhotoWorker] job ownership lost before final commit:',
    job.id
  )

  return
}

    const finalPayload = {
      public_url: previewUrl,
      image_url: previewUrl,
      storage_path: previewPath,

      preview_path: previewPath,
      preview_url: previewUrl,
      preview_size_bytes: objectPlan.shouldUploadPreview
        ? previewBuffer.byteLength
        : 0,

      thumbnail_path: thumbnailPath,
      thumbnail_url: thumbnailUrl,
      thumbnail_size_bytes: thumbnailBuffer.byteLength,

      sd_path: sdPath,
      sd_url: sdUrl,
      hd_path: hdPath,
      hd_url: hdUrl,
      uhd_path: uhdPath,
      uhd_url: uhdUrl,

      // The original moved to the private bucket, so its old public URL is
      // gone. Downloads read it server-side by original_path (kept as-is).
      ...(storageContext.provider === 'r2' || originalWasRelocated
        ? { original_url: null }
        : {}),

      // The raw `original/` file was removed in favour of the baked full-res at
      // previewPath, so point original_path/url there — that is now the
      // downloadable "original" deliverable (with the preset baked in).
      ...(processedOriginalReplacesRaw
        ? { original_path: previewPath, original_url: previewUrl }
        : {}),

      blur_data_url: blurDataUrl,

      processing_status: 'done',
      processing_progress: 100,

      face_scan_status: FACE_SCAN_ENABLED ? 'pending' : 'skipped',
      face_scan_progress: FACE_SCAN_ENABLED ? 0 : 100,
      face_scan_error: FACE_SCAN_ENABLED ? null : 'FACE_SCAN_ENABLED is false',
      faces_count: 0,

      updated_at: new Date().toISOString(),
    }

    const updateResult = await withRetry(() =>
      supabase.from('photos').update(finalPayload).eq('id', String(job.photo_id))
    )

    if (updateResult.error) {
      throw new Error(updateResult.error.message)
    }

    await queueFaceJob({
      job,
      imagePath:
        storageContext.provider === 'r2' ? previewPath : hdPath || previewPath,
      imageUrl: previewUrl,
      storageProvider: storageContext.provider,
      storageBucket: outputBucket,
    })

    const jobMarkedDone = await markJobDone(job)

if (!jobMarkedDone) {
  return
}

processedJobsCount += 1
totalProcessingMs += Date.now() - startedAt

console.log('[PhotoWorker] done:', job.id)


   } catch (error) {
    const message = error instanceof Error ? error.message : 'Process failed'

    console.error('[PhotoWorker] failed:', job.id, message)

    const failureRecorded =
  await markJobFailedOrRetry(
    job,
    message
  )

if (failureRecorded) {
  failedJobsCount += 1
}
  } finally {
  for (const buffer of jobBuffers) {
    buffer.fill(0)
  }

  jobBuffers.clear()


  if (
    processedJobsCount > 0 &&
    processedJobsCount % 100 === 0
  ) {
    global.gc?.()
  }

  activeJobsCount = Math.max(
    0,
    activeJobsCount - 1
  )
}
}

async function pollJobs() {
  if (isShuttingDown) {
  return
}

  const workerName = WORKER_ID

  const claimResults = await Promise.allSettled(
    Array.from({ length: WORKER_LIMIT }).map(() =>
      withRetry(() =>
        supabase.rpc('claim_next_photo_job', {
          worker_name: workerName,
          max_per_album: MAX_PER_ALBUM,
        })
      )
    )
  )

  const jobs: PhotoJob[] = []

  for (const result of claimResults) {
    if (result.status === 'rejected') {
      console.error('[PhotoWorker] claim rpc failed:', result.reason)
      continue
    }

    if (result.value.error) {
      console.error('[PhotoWorker] claim rpc error:', result.value.error.message)
      continue
    }

    const job = result.value.data?.[0]

    if (job) {
      jobs.push(job as PhotoJob)
    }
  }

  if (jobs.length === 0) {
    return
  }

  console.log(`[PhotoWorker] claimed ${jobs.length} jobs`)

  await Promise.allSettled(
    jobs.map((job) => processPhotoJob(job))
  )
}

async function start() {
  await pruneStaleHeartbeats()

  while (!isShuttingDown) {
    try {
      const now = Date.now()

      if (now - lastHeartbeatAt > 30 * 1000) {
        await sendHeartbeat()
        lastHeartbeatAt = now
      }

      if (now - lastRecoverAt > 60 * 1000) {
        await recoverStaleJobs()
        lastRecoverAt = now
      }

      if (now - lastMetricsAt > 60 * 1000) {
        await sendWorkerMetrics()
        lastMetricsAt = now
      }

      await pollJobs()
    } catch (error) {
      if (!isShuttingDown) {
        console.error(
          '[PhotoWorker] loop error:',
          error
        )
      }
    }

    if (!isShuttingDown) {
      await sleep(POLL_INTERVAL)
    }
  }

  await markWorkerOffline()
  console.log('[PhotoWorker] graceful shutdown complete')
}



start().catch((error) => {
  console.error('[PhotoWorker] fatal:', error)
  process.exit(1)
})
