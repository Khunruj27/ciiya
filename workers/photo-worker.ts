import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import WebSocket from 'ws'

sharp.concurrency(Number(process.env.SHARP_CONCURRENCY || 1))
sharp.cache({
  memory: Number(process.env.SHARP_CACHE_MEMORY || 64),
  files: Number(process.env.SHARP_CACHE_FILES || 0),
  items: Number(process.env.SHARP_CACHE_ITEMS || 32),
})

type OutputSize = 'sd' | 'hd' | 'uhd' | 'thumbnail'
type SelectedSize = 'sd' | 'hd' | 'uhd' | 'original'

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

type XmpAdjustments = {
  exposure: number
  contrast: number
  saturation: number
  vibrance: number
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const POLL_INTERVAL = Number(process.env.WORKER_POLL_INTERVAL || 2000)
const WORKER_LIMIT = Number(process.env.WORKER_LIMIT || 2)
const FACE_SCAN_ENABLED = process.env.FACE_SCAN_ENABLED !== 'false'
const MAX_CLAIM_BATCH = Number(process.env.PHOTO_JOB_CLAIM_BATCH || 4)
const MAX_PER_ALBUM = Number(process.env.PHOTO_JOB_MAX_PER_ALBUM || 1)

let lastHeartbeatAt = 0
let lastRecoverAt = 0

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

const presetCache = new Map<string, XmpAdjustments | null>()

console.log('[PhotoWorker] started')
console.log('[PhotoWorker] FACE_SCAN_ENABLED =', FACE_SCAN_ENABLED)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(
  fn: () => PromiseLike<T>,
  retries = 5,
  baseDelay = 1200
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      console.error(`[PhotoWorker] retry ${attempt}/${retries} failed`, error)

      if (attempt < retries) {
        await sleep(baseDelay * attempt)
      }
    }
  }

  throw lastError
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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
  presetPath?: string | null
): Promise<XmpAdjustments | null> {
  if (!presetPath) return null

  if (presetCache.has(presetPath)) {
    return presetCache.get(presetPath) || null
  }

  try {
    const result = await withRetry(() =>
      supabase.storage.from('albums').download(presetPath)
    )

    if (result.error || !result.data) {
      console.warn('[PhotoWorker] preset download failed:', result.error?.message)
      presetCache.set(presetPath, null)
      return null
    }

    const xmp = Buffer.from(await result.data.arrayBuffer()).toString('utf-8')

    const preset: XmpAdjustments = {
      exposure: getXmpNumber(xmp, 'Exposure2012'),
      contrast: getXmpNumber(xmp, 'Contrast2012'),
      saturation: getXmpNumber(xmp, 'Saturation'),
      vibrance: getXmpNumber(xmp, 'Vibrance'),
    }

    console.log('[PhotoWorker] loaded xmp:', preset)

    presetCache.set(presetPath, preset)

    return preset
  } catch (error) {
    console.error('[PhotoWorker] xmp parse failed:', error)
    presetCache.set(presetPath, null)
    return null
  }
}

function applyXmpAdjustments(image: sharp.Sharp, preset: XmpAdjustments | null) {
  if (!preset) return image

  const brightness = clamp(1 + preset.exposure * 0.2, 0.6, 1.6)

  const saturation = clamp(
    1 + preset.saturation * 0.006 + preset.vibrance * 0.005,
    0.2,
    2
  )

  const contrast = clamp(1 + preset.contrast * 0.005, 0.7, 1.7)

  return image
    .modulate({
      brightness,
      saturation,
    })
    .linear(contrast, 128 - 128 * contrast)
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

function makeOutputPath(originalPath: string, folder: OutputSize) {
  const parts = originalPath.split('/')
  const name = parts[parts.length - 1]?.replace(/\.[^/.]+$/, '') || 'photo'

  return `${parts[0]}/${parts[1]}/${folder}/${name}.jpg`
}

async function updatePhoto(photoId: string, payload: Record<string, unknown>) {
  const result = await withRetry(() =>
    supabase
      .from('photos')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', photoId)
  )

  if (result.error) {
    console.error('[PhotoWorker] update photo failed:', result.error.message)
  }
}

async function sendHeartbeat() {
  const result = await withRetry(() =>
    supabase.from('worker_heartbeats').upsert(
      {
        worker_id: `photo-worker-${process.pid}`,
        worker_name: `photo-worker-${process.pid}`,
        worker_type: 'photo',
        status: 'online',
        last_seen: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        metadata: {
          pid: process.pid,
          node: process.version,
          workerLimit: WORKER_LIMIT,
          maxClaimBatch: MAX_CLAIM_BATCH,
          maxPerAlbum: MAX_PER_ALBUM,
          faceScanEnabled: FACE_SCAN_ENABLED,
        },
      },
      { onConflict: 'worker_id' }
    )
  )

  if (result.error) {
    console.error('[PhotoWorker] heartbeat failed:', result.error.message)
  }
}

async function recoverStaleJobs() {
  const staleSince = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const result = await withRetry(() =>
    supabase
      .from('photo_jobs')
      .update({
        status: 'pending',
        progress: 0,
        error: 'Recovered stale processing job',
        started_at: null,
        finished_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'processing')
      .lt('started_at', staleSince)
  )

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

  return `data:image/jpeg;base64,${tiny.toString('base64')}`
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

async function queueFaceJob(params: {
  job: PhotoJob
  imagePath: string
  imageUrl: string
}) {
  const { job, imagePath, imageUrl } = params

  if (!FACE_SCAN_ENABLED) {
    await updatePhoto(String(job.photo_id), {
      face_scan_status: 'skipped',
      face_scan_progress: 100,
      face_scan_error: 'FACE_SCAN_ENABLED is false',
      faces_count: 0,
    })

    return
  }

  const existingResult = await withRetry(() =>
    supabase
      .from('face_jobs')
      .select('id,status')
      .eq('photo_id', String(job.photo_id))
      .in('status', ['pending', 'processing', 'done'])
      .maybeSingle()
  )

  if (existingResult.error) {
    console.error('[PhotoWorker] check face job failed:', existingResult.error.message)
    return
  }

  if (existingResult.data) {
    await updatePhoto(String(job.photo_id), {
      face_scan_status:
        existingResult.data.status === 'done' ? 'done' : 'pending',
      face_scan_progress: existingResult.data.status === 'done' ? 100 : 0,
      face_scan_error: null,
    })

    return
  }

  const faceJobResult = await withRetry(() =>
    supabase.from('face_jobs').insert({
      photo_id: String(job.photo_id),
      album_id: String(job.album_id),
      owner_id: String(job.owner_id),
      image_path: imagePath,
      image_url: imageUrl,
      status: 'pending',
      progress: 0,
      priority: 100,
      retry_count: 0,
      payload: {
        source: 'photo-worker',
        photoId: String(job.photo_id),
        albumId: String(job.album_id),
      },
    })
  )

  if (faceJobResult.error) {
    console.error('[PhotoWorker] queue face job failed:', faceJobResult.error.message)

    await updatePhoto(String(job.photo_id), {
      face_scan_status: 'failed',
      face_scan_progress: 100,
      face_scan_error: faceJobResult.error.message,
    })

    return
  }

  await updatePhoto(String(job.photo_id), {
    face_scan_status: 'pending',
    face_scan_progress: 0,
    face_scan_error: null,
    faces_count: 0,
  })
}

async function markJobDone(job: PhotoJob) {
  const result = await withRetry(() =>
    supabase
      .from('photo_jobs')
      .update({
        status: 'done',
        progress: 100,
        finished_at: new Date().toISOString(),
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', String(job.id))
  )

  if (result.error) {
    console.error('[PhotoWorker] mark job done failed:', result.error.message)
  }
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
  const retryCount = Number(job.retry_count || job.retries || 0)
  const maxRetries = isTransientError(message) ? 8 : 3
  const shouldRetry = retryCount < maxRetries
  const nextStatus = shouldRetry ? 'pending' : 'failed'

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
        finished_at: shouldRetry ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', String(job.id))
  )

  if (result.error) {
    console.error('[PhotoWorker] mark failed/retry failed:', result.error.message)
  }

  if (job.photo_id) {
    await updatePhoto(String(job.photo_id), {
      processing_status: nextStatus,
      processing_progress: 0,
    })
  }
}

async function processPhotoJob(job: PhotoJob) {
  try {
    console.log('[PhotoWorker] processing:', job.id)

    if (!job.photo_id) throw new Error('Missing photo_id')
    if (!job.original_path) throw new Error('Missing original_path')

    await updatePhoto(String(job.photo_id), {
      processing_status: 'processing',
      processing_progress: 10,
    })

    const downloadResult = await withRetry(() =>
      supabase.storage.from('albums').download(String(job.original_path))
    )

    if (downloadResult.error || !downloadResult.data) {
      throw new Error(downloadResult.error?.message || 'Cannot download original file')
    }

    const originalBuffer = Buffer.from(await downloadResult.data.arrayBuffer())
    const xmpPreset = await loadXmpAdjustments(job.preset_path || null)

    console.log('[PhotoWorker] preset path:', job.preset_path || null)

    const selectedSize = normalizeSelectedSize(
      String(job.size || 'hd').toLowerCase()
    )
    const previewWidth = getWidthBySize(selectedSize)

    const previewBuffer =
      selectedSize === 'original'
        ? originalBuffer
        : await generateResizeBuffer(originalBuffer, previewWidth, 86, xmpPreset)

    const previewPath =
      selectedSize === 'original'
        ? String(job.original_path)
        : makeOutputPath(String(job.original_path), selectedSize)

    if (selectedSize !== 'original') {
      const uploadPreviewResult = await withRetry(() =>
        supabase.storage.from('albums').upload(previewPath, previewBuffer, {
          contentType: 'image/jpeg',
          cacheControl: 'no-store',
          upsert: true,
        })
      )

      if (uploadPreviewResult.error) {
        throw new Error(uploadPreviewResult.error.message)
      }
    }

    const thumbnailBuffer = await applyXmpAdjustments(
      sharp(originalBuffer).rotate(),
      xmpPreset
    )
      .resize(480, 480, {
        fit: 'cover',
      })
      .jpeg({
        quality: 76,
        mozjpeg: true,
      })
      .toBuffer()

    const thumbnailPath = makeOutputPath(String(job.original_path), 'thumbnail')

    const uploadThumbResult = await withRetry(() =>
      supabase.storage.from('albums').upload(thumbnailPath, thumbnailBuffer, {
        contentType: 'image/jpeg',
        cacheControl: 'no-store',
        upsert: true,
      })
    )

    if (uploadThumbResult.error) {
      throw new Error(uploadThumbResult.error.message)
    }

    await updatePhoto(String(job.photo_id), {
      processing_progress: 60,
    })

    const { data: previewUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(previewPath)

    const { data: thumbUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(thumbnailPath)

    const blurDataUrl = await generateBlurDataUrl(originalBuffer)

    let hdPath: string | null = null
    let hdUrl: string | null = null

    if (selectedSize === 'hd') {
      hdPath = previewPath
      hdUrl = previewUrlData.publicUrl
    }

    if (selectedSize !== 'hd') {
  await updatePhoto(String(job.photo_id), {
    processing_progress: 78,
  })

  const hdBuffer = await generateResizeBuffer(
    originalBuffer,
    3000,
    84,
    xmpPreset
  )

  const generatedHdPath = makeOutputPath(String(job.original_path), 'hd')

      const uploadHdResult = await withRetry(() =>
        supabase.storage.from('albums').upload(generatedHdPath, hdBuffer, {
          contentType: 'image/jpeg',
          cacheControl: 'no-store',
          upsert: true,
        })
      )

      if (uploadHdResult.error) {
        throw new Error(uploadHdResult.error.message)
      }

      const { data } = supabase.storage.from('albums').getPublicUrl(generatedHdPath)

      hdPath = generatedHdPath
      hdUrl = data.publicUrl
    }

    const finalPayload = {
      public_url: previewUrlData.publicUrl,
      storage_path: previewPath,

      preview_path: previewPath,
      preview_url: previewUrlData.publicUrl,

      thumbnail_path: thumbnailPath,
      thumbnail_url: thumbUrlData.publicUrl,

      hd_path: hdPath,
      hd_url: hdUrl,

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
      imagePath: hdPath || previewPath,
      imageUrl: hdUrl || previewUrlData.publicUrl,
    })

    await markJobDone(job)

    console.log('[PhotoWorker] done:', job.id)

    sharp.cache(false)
    sharp.cache({
      memory: Number(process.env.SHARP_CACHE_MEMORY || 64),
      files: Number(process.env.SHARP_CACHE_FILES || 0),
      items: Number(process.env.SHARP_CACHE_ITEMS || 32),
    })

    global.gc?.()

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Process failed'

    console.error('[PhotoWorker] failed:', job.id, message)

    await markJobFailedOrRetry(job, message)
  }
}

async function pollJobs() {
  const result = await withRetry(() =>
    supabase.rpc('claim_photo_jobs', {
      claim_limit: WORKER_LIMIT,
      claim_batch: MAX_CLAIM_BATCH,
      max_per_album: MAX_PER_ALBUM,
    })
  )

  if (result.error) {
    console.error('[PhotoWorker] claim rpc error:', result.error.message)
    return
  }

  const jobs = result.data || []

  if (jobs.length === 0) {
    return
  }

  console.log(`[PhotoWorker] claimed ${jobs.length} jobs`)

   await Promise.allSettled(
    (jobs as PhotoJob[]).map((job) => processPhotoJob(job))
  )
}

async function start() {
  while (true) {
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

      await pollJobs()
    } catch (error) {
      console.error('[PhotoWorker] loop error:', error)
    }

    await sleep(POLL_INTERVAL)
  }
}

start().catch((error) => {
  console.error('[PhotoWorker] fatal:', error)
  process.exit(1)
})