import { config } from 'dotenv'

config({
  path: '.env.local',
})

import path from 'path'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import * as faceapi from '@vladmandic/face-api'
import canvas from 'canvas'
import WebSocket from 'ws'

type OutputSize = 'sd' | 'hd' | 'uhd' | 'thumbnail'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const POLL_INTERVAL = Number(process.env.WORKER_POLL_INTERVAL || 3000)
const WORKER_LIMIT = Number(process.env.WORKER_LIMIT || 1)
const FACE_SCAN_ENABLED = process.env.FACE_SCAN_ENABLED === 'true'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
  transport: WebSocket as any,
},
})

const { Canvas, Image, ImageData } = canvas

faceapi.env.monkeyPatch({
  Canvas: Canvas as any,
  Image: Image as any,
  ImageData: ImageData as any,
})

let faceModelsLoaded = false

console.log('Photo worker started')
console.log('[Worker] FACE_SCAN_ENABLED =', process.env.FACE_SCAN_ENABLED)
console.log('[Worker] FACE_SCAN_ENABLED parsed =', FACE_SCAN_ENABLED)
console.log('[Worker] NODE_VERSION =', process.version)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadFaceModels() {
  if (faceModelsLoaded) return

  const modelPath = path.join(process.cwd(), 'public', 'models')

  console.log('[FaceScan] model path:', modelPath)
  console.log('[FaceScan] loading tinyFaceDetector...')

  await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath)

  console.log('[FaceScan] loading faceLandmark68Net...')

  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath)

  console.log('[FaceScan] loading faceRecognitionNet...')

  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath)

  faceModelsLoaded = true

  console.log('[Worker] face models loaded')
}

function makeOutputPath(originalPath: string, folder: OutputSize) {
  const parts = originalPath.split('/')
  const name = parts[parts.length - 1]?.replace(/\.[^/.]+$/, '') || 'photo'

  return `${parts[0]}/${parts[1]}/${folder}/${name}.jpg`
}

async function updatePhoto(photoId: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from('photos').update(payload).eq('id', photoId)

  if (error) {
    console.error('[Worker] update photo failed:', error.message)
  }
}

async function updateProgress(photoId: string, progress: number, status?: string) {
  const payload: Record<string, unknown> = {
    processing_progress: progress,
  }

  if (status) payload.processing_status = status

  await updatePhoto(photoId, payload)
}

async function updateFaceProgress(
  photoId: string,
  progress: number,
  status?: string,
  extra: Record<string, unknown> = {}
) {
  const payload: Record<string, unknown> = {
    face_scan_progress: progress,
    ...extra,
  }

  if (status) payload.face_scan_status = status

  await updatePhoto(photoId, payload)
}

async function logWorkerError(
  job: any,
  message: string,
  meta: Record<string, unknown> = {}
) {
  const { error } = await supabase.from('worker_logs').insert({
    job_id: job?.id || null,
    photo_id: job?.photo_id || null,
    owner_id: job?.owner_id || null,
    album_id: job?.album_id || null,
    level: 'error',
    message,
    meta,
  })

  if (error) {
    console.error('[Worker] log insert failed:', error.message)
  }
}

async function generateResizeBuffer(buffer: Buffer, width: number, quality = 86) {
  return sharp(buffer)
    .rotate()
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

async function scanFaces(buffer: Buffer) {
  console.log('[FaceScan] loading models...')

  await loadFaceModels()

  console.log('[FaceScan] models loaded')
  console.log('[FaceScan] image buffer size:', buffer.length)

  const img = await canvas.loadImage(buffer)

  console.log('[FaceScan] image loaded')
  console.log('[FaceScan] image width:', img.width)
  console.log('[FaceScan] image height:', img.height)

  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 512,
    scoreThreshold: 0.45,
  })

  console.log('[FaceScan] detector options ready')

  const detections = await faceapi
    .detectAllFaces(img as any, options)
    .withFaceLandmarks()
    .withFaceDescriptors()

  console.log('[FaceScan] detections complete')
  console.log('[FaceScan] faces found:', detections.length)

  return detections
}

function getSelectedOutput(
  selectedSize: string,
  originalPath: string,
  originalUrl: string,
  sdPath: string,
  sdUrl: string,
  hdPath: string,
  hdUrl: string,
  uhdPath: string,
  uhdUrl: string
) {
  if (selectedSize === 'sd') return { path: sdPath, url: sdUrl, label: 'sd' }

  if (selectedSize === 'uhd') return { path: uhdPath, url: uhdUrl, label: 'uhd' }

  if (selectedSize === 'original') {
    return { path: originalPath, url: originalUrl, label: 'original' }
  }

  return { path: hdPath, url: hdUrl, label: 'hd' }
}

async function claimJob(job: any) {
  const { data, error } = await supabase
    .from('photo_jobs')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) {
    await logWorkerError(job, error.message, {
      stage: 'claim_job',
    })

    return false
  }

  return Boolean(data)
}

async function markJobDone(job: any) {
  await supabase
    .from('photo_jobs')
    .update({
      status: 'done',
      finished_at: new Date().toISOString(),
      error: null,
    })
    .eq('id', job.id)
}

async function markJobFailedOrRetry(job: any, message: string) {
  const retryCount = Number(job.retry_count || 0)
  const maxRetries = 3
  const shouldRetry = retryCount < maxRetries

  await logWorkerError(job, message, {
    stage: 'external_photo_worker',
    retryCount,
    willRetry: shouldRetry,
    originalPath: job.original_path,
    size: job.size,
  })

  await supabase
    .from('photo_jobs')
    .update({
      status: shouldRetry ? 'pending' : 'failed',
      retry_count: retryCount + 1,
      error: message,
      started_at: null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', job.id)

  await updatePhoto(job.photo_id, {
    processing_status: shouldRetry ? 'pending' : 'failed',
    processing_progress: 0,
  })
}

async function recoverStaleJobs() {
  const staleMinutes = 10
  const staleSince = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('photo_jobs')
    .update({
      status: 'pending',
      error: 'Recovered stale processing job',
      retry_count: 0,
      started_at: null,
    })
    .eq('status', 'processing')
    .lt('started_at', staleSince)

  if (error) {
    console.error('[Worker] recover stale jobs failed:', error.message)
  }
}

async function runFaceScanSafe(job: any, imageBuffer: Buffer) {
  try {
    console.log(`[FaceScan] requested for photo ${job.photo_id}`)
    console.log('[FaceScan] FACE_SCAN_ENABLED raw =', process.env.FACE_SCAN_ENABLED)
    console.log('[FaceScan] FACE_SCAN_ENABLED parsed =', FACE_SCAN_ENABLED)

    await updateFaceProgress(job.photo_id, 10, 'processing', {
      face_scan_error: null,
      faces_count: 0,
    })

    console.log('[FaceScan] deleting old faces...')

    await supabase.from('photo_faces').delete().eq('photo_id', job.photo_id)

    console.log('[FaceScan] old faces deleted')

    await updateFaceProgress(job.photo_id, 30, 'processing')

    if (!FACE_SCAN_ENABLED) {
      await updateFaceProgress(job.photo_id, 100, 'skipped', {
        faces_count: 0,
        face_scan_error: 'FACE_SCAN_ENABLED is not true',
      })

      console.log(`[Worker] face scan skipped ${job.photo_id}`)
      return
    }

    console.log(`[FaceScan] start scan ${job.photo_id}`)

    await updateFaceProgress(job.photo_id, 50, 'processing')

    console.log('[FaceScan] calling scanFaces()')

    const detections = await scanFaces(imageBuffer)

    console.log('[FaceScan] scanFaces() done')

    await updateFaceProgress(job.photo_id, 80, 'processing')

    console.log('[FaceScan] preparing rows...')

    if (detections.length > 0) {
      const rows = detections.map((detection: any, index: number) => ({
        photo_id: job.photo_id,
        album_id: job.album_id,
        owner_id: job.owner_id,
        face_index: index,

        box_x: detection.detection.box.x,
        box_y: detection.detection.box.y,
        box_width: detection.detection.box.width,
        box_height: detection.detection.box.height,

        descriptor: Array.from(detection.descriptor),
        person_cluster_id: null,
      }))

      console.log('[FaceScan] inserting rows:', rows.length)

      const { error } = await supabase.from('photo_faces').insert(rows)

      console.log('[FaceScan] insert complete')

      if (error) throw new Error(error.message)
    } else {
      console.log('[FaceScan] no faces detected')
    }

    await updateFaceProgress(job.photo_id, 100, 'done', {
      faces_count: detections.length,
      face_scan_error: null,
    })

    console.log(`[Worker] detected ${detections.length} faces in ${job.photo_id}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Face scan failed'

    await logWorkerError(job, message, {
      stage: 'face_scan',
      photoId: job.photo_id,
    })

    await updateFaceProgress(job.photo_id, 100, 'failed', {
      face_scan_error: message,
      faces_count: 0,
    })

    console.error(`[Worker] face scan failed ${job.photo_id}:`, message)

    if (error instanceof Error) {
      console.error(error.stack)
    }
  }
}

async function processPhotoJob(job: any) {
  const claimed = await claimJob(job)

  if (!claimed) return

  try {
    console.log(`[Worker] processing job ${job.id}`)

    await updateProgress(job.photo_id, 10, 'processing')

    if (!job.original_path) {
      throw new Error('Missing original_path')
    }

    const { data: originalFile, error: downloadError } = await supabase.storage
      .from('albums')
      .download(job.original_path)

    if (downloadError || !originalFile) {
      throw new Error(
        downloadError?.message || `Original file download failed: ${job.original_path}`
      )
    }

    const buffer = Buffer.from(await originalFile.arrayBuffer())
    const originalSizeBytes = buffer.length

    await updateProgress(job.photo_id, 25, 'processing')

    const sdBuffer = await generateResizeBuffer(buffer, 2000, 86)

    await updateProgress(job.photo_id, 40, 'processing')

    const hdBuffer = await generateResizeBuffer(buffer, 3000, 86)

    await updateProgress(job.photo_id, 55, 'processing')

    const uhdBuffer = await generateResizeBuffer(buffer, 4000, 86)

    await updateProgress(job.photo_id, 70, 'processing')

    const thumbBuffer = await sharp(buffer)
      .rotate()
      .resize(480, 480, {
        fit: 'cover',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 76,
        mozjpeg: true,
      })
      .toBuffer()

    const sdPath = makeOutputPath(job.original_path, 'sd')
    const hdPath = makeOutputPath(job.original_path, 'hd')
    const uhdPath = makeOutputPath(job.original_path, 'uhd')
    const thumbPath = makeOutputPath(job.original_path, 'thumbnail')

    await updateProgress(job.photo_id, 80, 'processing')

    const [sdUpload, hdUpload, uhdUpload, thumbUpload] = await Promise.all([
      supabase.storage.from('albums').upload(sdPath, sdBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      }),
      supabase.storage.from('albums').upload(hdPath, hdBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      }),
      supabase.storage.from('albums').upload(uhdPath, uhdBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      }),
      supabase.storage.from('albums').upload(thumbPath, thumbBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      }),
    ])

    if (sdUpload.error) throw new Error(sdUpload.error.message)
    if (hdUpload.error) throw new Error(hdUpload.error.message)
    if (uhdUpload.error) throw new Error(uhdUpload.error.message)
    if (thumbUpload.error) throw new Error(thumbUpload.error.message)

    const { data: originalUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(job.original_path)

    const { data: sdUrlData } = supabase.storage.from('albums').getPublicUrl(sdPath)
    const { data: hdUrlData } = supabase.storage.from('albums').getPublicUrl(hdPath)
    const { data: uhdUrlData } = supabase.storage.from('albums').getPublicUrl(uhdPath)
    const { data: thumbUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(thumbPath)

    const selectedSize = String(job.size || 'hd').toLowerCase()

    const selected = getSelectedOutput(
      selectedSize,
      job.original_path,
      originalUrlData.publicUrl,
      sdPath,
      sdUrlData.publicUrl,
      hdPath,
      hdUrlData.publicUrl,
      uhdPath,
      uhdUrlData.publicUrl
    )

    const processedBytes =
      sdBuffer.length + hdBuffer.length + uhdBuffer.length + thumbBuffer.length

    const selectedProcessedBytes =
      selected.label === 'sd'
        ? sdBuffer.length
        : selected.label === 'uhd'
          ? uhdBuffer.length
          : selected.label === 'original'
            ? 0
            : hdBuffer.length

    const fullPayload = {
      public_url: selected.url,
      storage_path: selected.path,
      preview_path: selected.path,
      preview_url: selected.url,
      thumbnail_path: thumbPath,
      thumbnail_url: thumbUrlData.publicUrl,
      sd_path: sdPath,
      hd_path: hdPath,
      uhd_path: uhdPath,
      sd_url: sdUrlData.publicUrl,
      hd_url: hdUrlData.publicUrl,
      uhd_url: uhdUrlData.publicUrl,
      selected_size: selected.label,
      original_size_bytes: originalSizeBytes,
      preview_size_bytes: processedBytes,
      thumbnail_size_bytes: thumbBuffer.length,
      file_size_bytes: originalSizeBytes + processedBytes,
      processing_status: 'processing',
      processing_progress: 90,
      face_scan_status: 'pending',
      face_scan_progress: 0,
      faces_count: 0,
      face_scan_error: null,
    }

    const { error: updateError } = await supabase
      .from('photos')
      .update(fullPayload)
      .eq('id', job.photo_id)

    if (updateError) {
      console.error('[Worker] full photo update failed:', updateError.message)

      await updatePhoto(job.photo_id, {
        public_url: selected.url,
        storage_path: selected.path,
        preview_path: selected.path,
        preview_url: selected.url,
        thumbnail_path: thumbPath,
        thumbnail_url: thumbUrlData.publicUrl,
        original_size_bytes: originalSizeBytes,
        preview_size_bytes: selectedProcessedBytes,
        thumbnail_size_bytes: thumbBuffer.length,
        file_size_bytes:
          originalSizeBytes + selectedProcessedBytes + thumbBuffer.length,
        processing_status: 'processing',
        processing_progress: 90,
      })
    }

    await updatePhoto(job.photo_id, {
      processing_status: 'done',
      processing_progress: 100,
    })

    await runFaceScanSafe(job, hdBuffer)

    await markJobDone(job)

    console.log(`[Worker] job done ${job.id}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Process failed'

    console.error(`[Worker] job failed ${job.id}:`, message)

    await markJobFailedOrRetry(job, message)
  }
}

async function pollJobs() {
  await recoverStaleJobs()

  const { data: jobs, error } = await supabase
    .from('photo_jobs')
    .select('*')
    .eq('status', 'pending')
    .is('cancelled_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(WORKER_LIMIT)

  if (error) {
    console.error('[Worker] polling error:', error.message)
    return
  }

  if (!jobs || jobs.length === 0) {
    console.log('[Worker] no pending jobs')
    return
  }

  for (const job of jobs) {
    await processPhotoJob(job)
  }
}

async function start() {
  while (true) {
    try {
      await pollJobs()
    } catch (error) {
      console.error('[Worker] loop error:', error)
    }

    await sleep(POLL_INTERVAL)
  }
}

start().catch((error) => {
  console.error('[Worker] fatal error:', error)
  process.exit(1)
})