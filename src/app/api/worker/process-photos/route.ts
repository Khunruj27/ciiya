import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type XmpPreset = {
  exposure: number
  contrast: number
  saturation: number
  vibrance: number
  clarity: number
  blackAndWhite: boolean
}

type OutputSize = 'sd' | 'hd' | 'uhd' | 'thumbnail'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

async function updateProgress(
  supabase: any,
  photoId: string,
  progress: number,
  status?: string
) {
  const payload: Record<string, unknown> = {
    processing_progress: progress,
  }

  if (status) payload.processing_status = status

  await supabase.from('photos').update(payload).eq('id', photoId)
}

function isAuthorizedWorker(req: NextRequest) {
  const workerSecret = process.env.WORKER_SECRET

  if (process.env.NODE_ENV === 'production' && !workerSecret) {
    return false
  }

  if (!workerSecret) {
    return true
  }

  const authHeader = req.headers.get('authorization')
  const cronSecret = req.headers.get('x-worker-secret')

  return authHeader === `Bearer ${workerSecret}` || cronSecret === workerSecret
}

function num(value: string | null, fallback = 0) {
  if (!value) return fallback

  const parsed = Number(value.replace('+', '').trim())

  return Number.isFinite(parsed) ? parsed : fallback
}

function pickXmp(text: string, key: string) {
  const patterns = [
    new RegExp(`crs:${key}="([^"]+)"`, 'i'),
    new RegExp(`${key}="([^"]+)"`, 'i'),
    new RegExp(`<crs:${key}>([^<]+)</crs:${key}>`, 'i'),
    new RegExp(`<${key}>([^<]+)</${key}>`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }

  return null
}

async function parsePresetFromStorage(
  supabase: any,
  presetPath: string | null
): Promise<XmpPreset | null> {
  if (!presetPath) return null

  const { data, error } = await supabase.storage
    .from('albums')
    .download(presetPath)

  if (error || !data) return null

  const text = await data.text()
  const treatment = (pickXmp(text, 'Treatment') || '').toLowerCase()
  const grayscale = (pickXmp(text, 'ConvertToGrayscale') || '').toLowerCase()

  return {
    exposure: num(pickXmp(text, 'Exposure2012')),
    contrast: num(pickXmp(text, 'Contrast2012')),
    saturation: num(pickXmp(text, 'Saturation')),
    vibrance: num(pickXmp(text, 'Vibrance')),
    clarity: num(pickXmp(text, 'Clarity2012')),
    blackAndWhite:
      treatment.includes('black') ||
      treatment.includes('b&w') ||
      treatment.includes('grayscale') ||
      grayscale === 'true' ||
      grayscale === '1',
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function makeOutputPath(originalPath: string, folder: OutputSize) {
  const parts = originalPath.split('/')
  const name = parts[parts.length - 1]?.replace(/\.[^/.]+$/, '') || 'photo'

  return `${parts[0]}/${parts[1]}/${folder}/${name}.jpg`
}

function applyPresetToImage(img: any, preset: XmpPreset | null) {
  if (!preset) return img

  const brightness = clamp(1 + preset.exposure / 5, 0.65, 1.6)

  const saturation = preset.blackAndWhite
    ? 0
    : clamp(1 + (preset.saturation + preset.vibrance) / 140, 0.5, 1.9)

  const contrast = clamp(1 + preset.contrast / 150, 0.75, 1.55)

  let next = img

  if (preset.blackAndWhite) {
    next = next.grayscale()
  }

  next = next.modulate({ brightness, saturation }).linear(contrast, 0)

  if (preset.clarity > 0) next = next.sharpen()

  if (preset.clarity < 0) {
    next = next.blur(clamp(Math.abs(preset.clarity) / 90, 0.3, 1.1))
  }

  return next
}

async function generateResizeBuffer(
  sharp: any,
  buffer: Buffer,
  width: number,
  preset: XmpPreset | null,
  quality = 86
) {
  let img = sharp(buffer).rotate().resize({
    width,
    fit: 'inside',
    withoutEnlargement: true,
  })

  img = applyPresetToImage(img, preset)

  return img
    .jpeg({
      quality,
      mozjpeg: true,
    })
    .toBuffer()
}

async function safeUpdatePhoto(
  supabase: any,
  photoId: string,
  payload: Record<string, unknown>
) {
  await supabase.from('photos').update(payload).eq('id', photoId)
}

async function safeUpdatePhotoWithFallback(
  supabase: any,
  photoId: string,
  payload: Record<string, unknown>,
  fallbackPayload: Record<string, unknown>
) {
  const { error } = await supabase
    .from('photos')
    .update(payload)
    .eq('id', photoId)

  if (error) {
    console.error('Update photo with multi-size columns failed:', error.message)

    const { error: fallbackError } = await supabase
      .from('photos')
      .update(fallbackPayload)
      .eq('id', photoId)

    if (fallbackError) {
      console.error('Fallback update photo failed:', fallbackError.message)
    }
  }
}

async function logWorkerError(
  supabase: any,
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
    console.error('Worker log insert error:', error.message)
  }
}

async function recoverStaleJobs(supabase: any) {
  const staleMinutes = 10

  const staleSince = new Date(
    Date.now() - staleMinutes * 60 * 1000
  ).toISOString()

  const { error } = await supabase
    .from('photo_jobs')
    .update({
      status: 'pending',
      error: 'Recovered stale processing job',
      retry_count: 0,
    })
    .eq('status', 'processing')
    .lt('started_at', staleSince)

  if (error) {
    console.error('Recover stale jobs error:', error.message)
  }
}

async function cleanupOldWorkerLogs(supabase: any) {
  const keepDays = 30

  const olderThan = new Date(
    Date.now() - keepDays * 24 * 60 * 60 * 1000
  ).toISOString()

  const { error } = await supabase
    .from('worker_logs')
    .delete()
    .lt('created_at', olderThan)

  if (error) {
    console.error('Cleanup worker logs error:', error.message)
  }
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
  if (selectedSize === 'sd') {
    return {
      path: sdPath,
      url: sdUrl,
      label: 'sd',
    }
  }

  if (selectedSize === 'uhd') {
    return {
      path: uhdPath,
      url: uhdUrl,
      label: 'uhd',
    }
  }

  if (selectedSize === 'original') {
    return {
      path: originalPath,
      url: originalUrl,
      label: 'original',
    }
  }

  return {
    path: hdPath,
    url: hdUrl,
    label: 'hd',
  }
}

async function processOneJob(job: any) {
  const supabase = getSupabaseAdmin()

  const { data: claimedJob, error: claimError } = await supabase
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

  if (claimError) {
    await logWorkerError(supabase, job, claimError.message, {
      stage: 'claim_job',
    })

    return {
      jobId: job.id,
      success: false,
      error: claimError.message,
    }
  }

  if (!claimedJob) {
    return {
      jobId: job.id,
      skipped: true,
    }
  }

  try {
    await updateProgress(supabase, job.photo_id, 10, 'processing')

    const { data: blob, error: downloadError } = await supabase.storage
      .from('albums')
      .download(job.original_path)

    if (downloadError || !blob) {
      throw new Error(
        downloadError?.message || `Original file not found: ${job.original_path}`
      )
    }

    const buffer = Buffer.from(await blob.arrayBuffer())
    const originalSizeBytes = buffer.length

    const sharp = (await import('sharp')).default

    const preset = await parsePresetFromStorage(
      supabase,
      job.preset_path || null
    )

    await updateProgress(supabase, job.photo_id, 25, 'processing')

    const sdBuffer = await generateResizeBuffer(sharp, buffer, 2000, preset, 86)

    await updateProgress(supabase, job.photo_id, 40, 'processing')

    const hdBuffer = await generateResizeBuffer(sharp, buffer, 3000, preset, 86)

    await updateProgress(supabase, job.photo_id, 55, 'processing')

    const uhdBuffer = await generateResizeBuffer(sharp, buffer, 4000, preset, 86)

    await updateProgress(supabase, job.photo_id, 70, 'processing')

    let thumbImg = sharp(buffer).rotate().resize(480, 480, {
      fit: 'cover',
      withoutEnlargement: true,
    })

    thumbImg = applyPresetToImage(thumbImg, preset)

    const thumbBuffer = await thumbImg
      .jpeg({
        quality: 76,
        mozjpeg: true,
      })
      .toBuffer()

    const sdPath = makeOutputPath(job.original_path, 'sd')
    const hdPath = makeOutputPath(job.original_path, 'hd')
    const uhdPath = makeOutputPath(job.original_path, 'uhd')
    const thumbPath = makeOutputPath(job.original_path, 'thumbnail')

    await updateProgress(supabase, job.photo_id, 80, 'processing')

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

    const { data: sdUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(sdPath)

    const { data: hdUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(hdPath)

    const { data: uhdUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(uhdPath)

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

      processing_status: 'done',
      processing_progress: 100,
    }

    const selectedProcessedBytes =
      selected.label === 'sd'
        ? sdBuffer.length
        : selected.label === 'uhd'
          ? uhdBuffer.length
          : selected.label === 'original'
            ? 0
            : hdBuffer.length

    const fallbackPayload = {
      public_url: selected.url,
      storage_path: selected.path,

      preview_path: selected.path,
      preview_url: selected.url,

      thumbnail_path: thumbPath,
      thumbnail_url: thumbUrlData.publicUrl,

      original_size_bytes: originalSizeBytes,
      preview_size_bytes: selectedProcessedBytes,
      thumbnail_size_bytes: thumbBuffer.length,
      file_size_bytes: originalSizeBytes + selectedProcessedBytes + thumbBuffer.length,

      processing_status: 'done',
      processing_progress: 100,
    }

    await safeUpdatePhotoWithFallback(
      supabase,
      job.photo_id,
      fullPayload,
      fallbackPayload
    )

    await supabase
      .from('photo_jobs')
      .update({
        status: 'done',
        finished_at: new Date().toISOString(),
        error: null,
      })
      .eq('id', job.id)

    return {
      jobId: job.id,
      photoId: job.photo_id,
      success: true,
      selectedSize: selected.label,
      selectedPath: selected.path,
      sdBytes: sdBuffer.length,
      hdBytes: hdBuffer.length,
      uhdBytes: uhdBuffer.length,
      thumbnailBytes: thumbBuffer.length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Process failed'

    await logWorkerError(supabase, job, message, {
      stage: 'process_job',
      originalPath: job.original_path,
      size: job.size,
      retryCount: Number(job.retry_count || 0),
      willRetry: Number(job.retry_count || 0) < 3,
    })

    const retryCount = Number(job.retry_count || 0)
    const maxRetries = 3
    const shouldRetry = retryCount < maxRetries

    await supabase
      .from('photo_jobs')
      .update({
        status: shouldRetry ? 'pending' : 'failed',
        retry_count: retryCount + 1,
        error: message,
        finished_at: new Date().toISOString(),
        started_at: null,
      })
      .eq('id', job.id)

    await safeUpdatePhoto(supabase, job.photo_id, {
      processing_status: shouldRetry ? 'pending' : 'failed',
      processing_progress: 0,
    })

    return {
      jobId: job.id,
      success: false,
      error: message,
      retryCount: retryCount + 1,
    }
  }
}

async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  task: (item: T) => Promise<R>
) {
  const results: R[] = []

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(task))
    results.push(...batchResults)
  }

  return results
}

async function handleWorker(req: NextRequest) {
  if (!isAuthorizedWorker(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()

  await recoverStaleJobs(supabase)
  await cleanupOldWorkerLogs(supabase)

  const rawLimit = Number(req.nextUrl.searchParams.get('limit') || 3)
  const limit = Math.min(Math.max(rawLimit, 1), 10)

  const rawConcurrency = Number(
    req.nextUrl.searchParams.get('concurrency') ||
      process.env.WORKER_CONCURRENCY ||
      1
  )

  const concurrency = Math.min(Math.max(rawConcurrency, 1), 2)

  const { data: jobs, error } = await supabase
    .from('photo_jobs')
    .select('*')
    .eq('status', 'pending')
    .is('cancelled_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
      },
      { status: 500 }
    )
  }

  if (!jobs?.length) {
    return NextResponse.json({
      success: true,
      processed: 0,
      message: 'No pending jobs',
    })
  }

  const results = await runInBatches(jobs, concurrency, processOneJob)

  return NextResponse.json({
    success: true,
    processed: jobs.length,
    concurrency,
    results,
    message: 'Worker completed successfully',
  })
}

export async function GET(req: NextRequest) {
  return handleWorker(req)
}

export async function POST(req: NextRequest) {
  return handleWorker(req)
}