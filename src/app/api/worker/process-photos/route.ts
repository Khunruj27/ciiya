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

  if (status) {
    payload.processing_status = status
  }

  await supabase.from('photos').update(payload).eq('id', photoId)
}

function isAuthorizedWorker(req: NextRequest) {
  const workerSecret = process.env.WORKER_SECRET
  if (!workerSecret) return true

  const header = req.headers.get('x-worker-secret')
  const query = req.nextUrl.searchParams.get('secret')

  return header === workerSecret || query === workerSecret
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

function makeOutputPath(originalPath: string, folder: 'preview' | 'thumbnail') {
  const parts = originalPath.split('/')
  const name = parts[parts.length - 1]?.replace(/\.[^/.]+$/, '') || 'photo'

  return `${parts[0]}/${parts[1]}/${folder}/${name}.jpg`
}

function getPreviewWidth(sizeValue: unknown): number | null {
  const size = String(sizeValue || 'original').toLowerCase()

  if (size === 'sd') return 2000
  if (size === 'hd') return 3000
  if (size === 'uhd') return 4000
  if (size === 'original') return null

  return 1500
}

async function safeUpdatePhoto(
  supabase: any,
  photoId: string,
  payload: Record<string, unknown>
) {
  await supabase.from('photos').update(payload).eq('id', photoId)
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
    return {
      jobId: job.id,
      photoId: job.photo_id,
      success: false,
      skipped: true,
      error: claimError.message,
    }
  }

  if (!claimedJob) {
    return {
      jobId: job.id,
      photoId: job.photo_id,
      success: true,
      skipped: true,
      message: 'Job already claimed',
    }
  }

  try {
    await updateProgress(supabase, job.photo_id, 10, 'processing')

    const { data: blob } = await supabase.storage
      .from('albums')
      .download(job.original_path)

    if (!blob) throw new Error('file not found')

    const buffer = Buffer.from(await blob.arrayBuffer())

    await updateProgress(supabase, job.photo_id, 30, 'processing')

    const sharp = (await import('sharp')).default

    const size = String(job.size || 'original').toLowerCase()
    const previewWidth = getPreviewWidth(size)

    const preset = await parsePresetFromStorage(
      supabase,
      job.preset_path || null
    )

    let img = sharp(buffer).rotate()

    if (previewWidth) {
      img = img.resize({
        width: previewWidth,
        fit: 'inside',
        withoutEnlargement: true,
      })
    }

    if (preset) {
      const brightness = clamp(1 + preset.exposure / 5, 0.65, 1.6)

      const saturation = preset.blackAndWhite
        ? 0
        : clamp(1 + (preset.saturation + preset.vibrance) / 140, 0.5, 1.9)

      const contrast = clamp(1 + preset.contrast / 150, 0.75, 1.55)

      if (preset.blackAndWhite) {
        img = img.grayscale()
      }

      img = img
        .modulate({
          brightness,
          saturation,
        })
        .linear(contrast, 0)

      if (preset.clarity > 0) {
        img = img.sharpen()
      }

      if (preset.clarity < 0) {
        img = img.blur(clamp(Math.abs(preset.clarity) / 90, 0.3, 1.1))
      }
    }

    const previewBuffer = await img
      .jpeg({
        quality: size === 'original' ? 88 : 86,
        mozjpeg: true,
      })
      .toBuffer()

    await updateProgress(supabase, job.photo_id, 60, 'processing')

    let thumbImg = sharp(buffer).rotate().resize(480, 480, {
      fit: 'cover',
      withoutEnlargement: true,
    })

    if (preset?.blackAndWhite) {
      thumbImg = thumbImg.grayscale()
    }

    const thumbBuffer = await thumbImg
      .jpeg({
        quality: 76,
        mozjpeg: true,
      })
      .toBuffer()

    await updateProgress(supabase, job.photo_id, 75, 'processing')

    const previewPath = makeOutputPath(job.original_path, 'preview')
    const thumbPath = makeOutputPath(job.original_path, 'thumbnail')

    await supabase.storage.from('albums').upload(previewPath, previewBuffer, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: true,
    })

    await supabase.storage.from('albums').upload(thumbPath, thumbBuffer, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: true,
    })

    await updateProgress(supabase, job.photo_id, 90, 'processing')

    const { data: pUrl } = supabase.storage
      .from('albums')
      .getPublicUrl(previewPath)

    const { data: tUrl } = supabase.storage
      .from('albums')
      .getPublicUrl(thumbPath)

    await safeUpdatePhoto(supabase, job.photo_id, {
      public_url: pUrl.publicUrl,
      storage_path: previewPath,
      preview_path: previewPath,
      preview_url: pUrl.publicUrl,
      thumbnail_path: thumbPath,
      thumbnail_url: tUrl.publicUrl,
      file_size_bytes: previewBuffer.length,
      processing_status: 'done',
      processing_progress: 100,
    })

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
      size,
      previewWidth,
      presetApplied: Boolean(preset),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Process failed'

    await supabase
      .from('photo_jobs')
      .update({
        status: 'failed',
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    await safeUpdatePhoto(supabase, job.photo_id, {
      processing_status: 'failed',
      processing_progress: 0,
    })

    return {
      jobId: job.id,
      photoId: job.photo_id,
      success: false,
      error: message,
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

  const rawLimit = Number(req.nextUrl.searchParams.get('limit') || 3)
  const limit = Math.min(Math.max(rawLimit, 1), 10)

  const rawConcurrency = Number(
    req.nextUrl.searchParams.get('concurrency') ||
      process.env.WORKER_CONCURRENCY ||
      3
  )

  const concurrency = Math.min(Math.max(rawConcurrency, 1), 3)

  const { data: jobs, error } = await supabase
    .from('photo_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        hint: 'Please create photo_jobs table first.',
      },
      { status: 500 }
    )
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({
      success: true,
      processed: 0,
      concurrency,
      message: 'No pending jobs',
    })
  }

  setTimeout(() => {
    runInBatches(jobs, concurrency, processOneJob).catch((error) => {
      console.error('Background worker error:', error)
    })
  }, 0)

  return NextResponse.json({
    success: true,
    started: jobs.length,
    concurrency,
    background: true,
    message: 'Worker started',
  })
}

export async function GET(req: NextRequest) {
  return handleWorker(req)
}

export async function POST(req: NextRequest) {
  return handleWorker(req)
}