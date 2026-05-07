import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase ENV')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function makeOutputPath(
  originalPath: string,
  folder: 'sd' | 'hd' | 'uhd' | 'thumbnail'
) {
  const parts = originalPath.split('/')
  const name = parts[parts.length - 1]?.replace(/\.[^/.]+$/, '') || 'photo'

  return `${parts[0]}/${parts[1]}/${folder}/${name}.jpg`
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

async function generateResizeBuffer(
  buffer: Buffer,
  width: number,
  quality = 86
) {
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

async function processOneJob(job: any) {
  const supabase = getSupabaseAdmin()

  const { data: claimedJob } = await supabase
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

  if (!claimedJob) return

  try {
    console.log('Processing job:', job.id)

    await updateProgress(supabase, job.photo_id, 10, 'processing')

    const { data: blob, error: downloadError } = await supabase.storage
      .from('albums')
      .download(job.original_path)

    if (downloadError || !blob) {
      throw new Error(downloadError?.message || 'Original file not found')
    }

    const buffer = Buffer.from(await blob.arrayBuffer())
    const originalSizeBytes = buffer.length

    await updateProgress(supabase, job.photo_id, 25, 'processing')

    const sdBuffer = await generateResizeBuffer(buffer, 2000)
    await updateProgress(supabase, job.photo_id, 40, 'processing')

    const hdBuffer = await generateResizeBuffer(buffer, 3000)
    await updateProgress(supabase, job.photo_id, 55, 'processing')

    const uhdBuffer = await generateResizeBuffer(buffer, 4000)
    await updateProgress(supabase, job.photo_id, 70, 'processing')

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

    await updateProgress(supabase, job.photo_id, 80, 'processing')

    const uploads = await Promise.all([
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

    for (const upload of uploads) {
      if (upload.error) throw new Error(upload.error.message)
    }

    const { data: originalUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(job.original_path)

    const { data: sdUrlData } = supabase.storage.from('albums').getPublicUrl(sdPath)
    const { data: hdUrlData } = supabase.storage.from('albums').getPublicUrl(hdPath)
    const { data: uhdUrlData } = supabase.storage.from('albums').getPublicUrl(uhdPath)
    const { data: thumbUrlData } = supabase.storage.from('albums').getPublicUrl(thumbPath)

    const selectedSize = String(job.size || 'hd').toLowerCase()

    const selected =
      selectedSize === 'sd'
        ? { path: sdPath, url: sdUrlData.publicUrl, label: 'sd' }
        : selectedSize === 'uhd'
          ? { path: uhdPath, url: uhdUrlData.publicUrl, label: 'uhd' }
          : selectedSize === 'original'
            ? { path: job.original_path, url: originalUrlData.publicUrl, label: 'original' }
            : { path: hdPath, url: hdUrlData.publicUrl, label: 'hd' }

    const processedBytes =
      sdBuffer.length + hdBuffer.length + uhdBuffer.length + thumbBuffer.length

    await supabase
      .from('photos')
      .update({
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
      })
      .eq('id', job.photo_id)

    await supabase
      .from('photo_jobs')
      .update({
        status: 'done',
        finished_at: new Date().toISOString(),
        error: null,
      })
      .eq('id', job.id)

    console.log('Job done:', job.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Process failed'
    const retryCount = Number(job.retry_count || 0)
    const shouldRetry = retryCount < 3

    console.error('Job failed:', job.id, message)

    await supabase.from('worker_logs').insert({
      job_id: job.id,
      photo_id: job.photo_id,
      owner_id: job.owner_id,
      album_id: job.album_id,
      level: 'error',
      message,
      meta: {
        stage: 'external_worker',
        retryCount,
        willRetry: shouldRetry,
      },
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

    await supabase
      .from('photos')
      .update({
        processing_status: shouldRetry ? 'pending' : 'failed',
        processing_progress: 0,
      })
      .eq('id', job.photo_id)
  }
}

async function runWorkerLoop() {
  const supabase = getSupabaseAdmin()

  console.log('Photo worker started')

  while (true) {
    const { data: jobs, error } = await supabase
      .from('photo_jobs')
      .select('*')
      .eq('status', 'pending')
      .is('cancelled_at', null)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)

    if (error) {
      console.error('Fetch jobs error:', error.message)
      await sleep(5000)
      continue
    }

    if (!jobs || jobs.length === 0) {
      await sleep(5000)
      continue
    }

    for (const job of jobs) {
      await processOneJob(job)
    }
  }
}

runWorkerLoop().catch((error) => {
  console.error('Worker fatal error:', error)
  process.exit(1)
})