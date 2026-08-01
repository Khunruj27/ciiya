import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
  )
}

const supabase = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

const DEFAULT_POLL_INTERVAL =
  60 * 60 * 1000

const configuredPollInterval = Number(
  process.env.QUEUE_CONSISTENCY_INTERVAL ??
    DEFAULT_POLL_INTERVAL
)

const POLL_INTERVAL =
  Number.isSafeInteger(configuredPollInterval) &&
  configuredPollInterval >= 1000 &&
  configuredPollInterval <=
    24 * 60 * 60 * 1000
    ? configuredPollInterval
    : DEFAULT_POLL_INTERVAL

let isShuttingDown = false
let lastWorkerCleanupAt = 0
const wakeSleepers = new Set<() => void>()

console.log('[QueueConsistencyWorker] started')

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

async function withRetry<T extends { error?: unknown }>(
  operation: () => PromiseLike<T>,
  attempts = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastResult: T | null = null
  let lastThrownError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (isShuttingDown) {
      throw new Error('Worker is shutting down')
    }

    try {
      const result = await operation()

      if (!result.error) {
        return result
      }

      lastResult = result
      lastThrownError = result.error
    } catch (error) {
      lastThrownError = error
    }

    if (attempt < attempts && !isShuttingDown) {
      await sleep(baseDelayMs * attempt)
    }
  }

  if (lastResult) {
    return lastResult
  }

  if (lastThrownError instanceof Error) {
    throw lastThrownError
  }

  throw new Error('Supabase operation failed after retries')
}

function requestShutdown(signal: string) {
  if (isShuttingDown) return

  isShuttingDown = true

  console.log(`[QueueConsistencyWorker] received ${signal}, shutting down`)

  for (const wake of [...wakeSleepers]) {
    wake()
  }
}

process.on('SIGTERM', () => requestShutdown('SIGTERM'))
process.on('SIGINT', () => requestShutdown('SIGINT'))




async function recoverStalePhotoJobs() {
  const staleSince = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { error } = await withRetry(() =>
    supabase
      .from('photo_jobs')
      .update({
        status: 'pending',
        progress: 0,
        error: 'Recovered by queue consistency worker',
        started_at: null,
        finished_at: null,
        worker_id: null,
        claimed_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'processing')
      .lt('started_at', staleSince)
  )

  if (error) {
    console.error(
      '[QueueConsistencyWorker] photo recovery failed:',
      error.message
    )
  }
}

async function recoverStaleFaceJobs() {
  const staleSince = new Date(Date.now() - 20 * 60 * 1000).toISOString()

  const { error } = await withRetry(() =>
    supabase
      .from('face_jobs')
      .update({
        status: 'pending',
        progress: 0,
        error: 'Recovered by queue consistency worker',
        started_at: null,
        finished_at: null,
        worker_id: null,
        claimed_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'processing')
      .lt('started_at', staleSince)
  )

  if (error) {
    console.error(
      '[QueueConsistencyWorker] face recovery failed:',
      error.message
    )
  }
}

async function repairMissingFaceJobs() {
  const { data: photos, error } = await withRetry(() =>
    supabase
      .from('photos')
      .select(`
        id,
        owner_id,
        album_id,
        hd_path,
        preview_path,
        original_path
      `)
      .eq('processing_status', 'done')
  )

  if (error) {
    console.error(
      '[QueueConsistencyWorker] load photos for face jobs failed:',
      error.message
    )
    return
  }

  if (!photos?.length) {
    return
  }

  for (const photo of photos) {
    const { data: existingJob } = await withRetry(() =>
      supabase
        .from('face_jobs')
        .select('id')
        .eq('photo_id', photo.id)
        .maybeSingle()
    )

    if (existingJob) {
      continue
    }

    const imagePath =
      photo.hd_path ??
      photo.preview_path ??
      photo.original_path

    if (
      !photo.owner_id ||
      !photo.album_id ||
      !imagePath
    ) {
      continue
    }

    const { error: insertError } =
      await withRetry(() =>
        supabase
          .from('face_jobs')
          .insert({
            photo_id: photo.id,
            owner_id: photo.owner_id,
            album_id: photo.album_id,
            image_path: imagePath,
            status: 'pending',
            progress: 0,
          })
      )

    if (
      insertError &&
      !String(insertError.message).includes(
        'duplicate'
      )
    ) {
      console.error(
        '[QueueConsistencyWorker] create face job failed:',
        insertError.message
      )
    } else {
      console.log(
        `[QueueConsistencyWorker] repaired missing face job ${photo.id}`
      )
    }
  }
}

async function repairPhotoJobConsistency() {
  const now = new Date().toISOString()

  const repairs = [
  withRetry(() =>
    supabase
      .from('photo_jobs')
      .update({
        progress: 0,
        worker_id: null,
        claimed_by: null,
        started_at: null,
        finished_at: null,
        updated_at: now,
      })
      .eq('status', 'pending')
      .or(
        'progress.neq.0,worker_id.not.is.null,claimed_by.not.is.null,started_at.not.is.null,finished_at.not.is.null'
      )
  ),

  withRetry(() =>
    supabase
      .from('photo_jobs')
      .update({
        progress: 100,
        worker_id: null,
        claimed_by: null,
        started_at: null,
        updated_at: now,
      })
      .eq('status', 'done')
      .or(
        'progress.neq.100,worker_id.not.is.null,claimed_by.not.is.null,started_at.not.is.null'
      )
  ),

  withRetry(() =>
    supabase
      .from('photo_jobs')
      .update({
        finished_at: null,
        updated_at: now,
      })
      .eq('status', 'processing')
      .not('finished_at', 'is', null)
  ),

  withRetry(() =>
    supabase
      .from('photo_jobs')
      .update({
        progress: 100,
        error: 'Unknown worker failure',
        worker_id: null,
        claimed_by: null,
        started_at: null,
        updated_at: now,
      })
      .eq('status', 'failed')
      .or(
        'error.is.null,progress.neq.100,worker_id.not.is.null,claimed_by.not.is.null,started_at.not.is.null'
      )
  ),
]

  const results = await Promise.allSettled(repairs)

  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.error) {
      console.error(
        '[QueueConsistencyWorker] photo repair failed:',
        result.value.error.message
      )
    }

    if (result.status === 'rejected') {
      console.error('[QueueConsistencyWorker] photo repair rejected:', result.reason)
    }
  })
}

async function repairFaceJobConsistency() {
  const now = new Date().toISOString()

  const repairs = [
  withRetry(() =>
    supabase
      .from('face_jobs')
      .update({
        progress: 0,
        worker_id: null,
        claimed_by: null,
        started_at: null,
        finished_at: null,
        updated_at: now,
      })
      .eq('status', 'pending')
      .or(
        'progress.neq.0,worker_id.not.is.null,claimed_by.not.is.null,started_at.not.is.null,finished_at.not.is.null'
      )
  ),

  withRetry(() =>
    supabase
      .from('face_jobs')
      .update({
        progress: 100,
        worker_id: null,
        claimed_by: null,
        started_at: null,
        updated_at: now,
      })
      .eq('status', 'done')
      .or(
        'progress.neq.100,worker_id.not.is.null,claimed_by.not.is.null,started_at.not.is.null'
      )
  ),

  withRetry(() =>
    supabase
      .from('face_jobs')
      .update({
        finished_at: null,
        updated_at: now,
      })
      .eq('status', 'processing')
      .not('finished_at', 'is', null)
  ),

  withRetry(() =>
    supabase
      .from('face_jobs')
      .update({
        progress: 100,
        error: 'Unknown worker failure',
        worker_id: null,
        claimed_by: null,
        started_at: null,
        updated_at: now,
      })
      .eq('status', 'failed')
      .or(
        'error.is.null,progress.neq.100,worker_id.not.is.null,claimed_by.not.is.null,started_at.not.is.null'
      )
  ),
]

  const results = await Promise.allSettled(repairs)

  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.error) {
      console.error(
        '[QueueConsistencyWorker] face repair failed:',
        result.value.error.message
      )
    }

    if (result.status === 'rejected') {
      console.error('[QueueConsistencyWorker] face repair rejected:', result.reason)
    }
  })
}

async function cleanupDeadWorkers() {
  const cutoff = new Date(
    Date.now() - 5 * 60 * 1000
  ).toISOString()

  const offlineAt = new Date().toISOString()

  const { error } = await withRetry(() =>
    supabase
      .from('worker_heartbeats')
      .update({
        status: 'offline',
        last_seen_at: offlineAt,
      })
      .eq('status', 'online')
      .lt('last_seen', cutoff)
  )

  if (error) {
    console.error(
      '[QueueConsistencyWorker] cleanup dead workers failed:',
      error.message
    )
  }
}

async function cleanupOldWorkerMetrics() {
  const cutoff = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString()

  const { error } = await withRetry(() =>
    supabase.from('worker_metrics').delete().lt('recorded_at', cutoff)
  )

  if (error) {
    console.error(
      '[QueueConsistencyWorker] cleanup worker metrics failed:',
      error.message
    )
  }
}

async function scanQueues() {
  await recoverStalePhotoJobs()
  await recoverStaleFaceJobs()

  const {
    data: repairedPhotoJobs,
    error: repairedPhotoJobsError,
  } = await withRetry(() =>
    supabase.rpc('repair_missing_photo_jobs')
  )

  if (repairedPhotoJobsError) {
    console.error(
      '[QueueConsistencyWorker] repair photo jobs rpc failed:',
      repairedPhotoJobsError.message
    )
  } else {
    console.log(
      `[QueueConsistencyWorker] repaired ${repairedPhotoJobs} missing photo jobs`
    )
  }

  // เปลี่ยนเป็น RPC หลังสร้าง SQL เสร็จ
  await repairMissingFaceJobs()

  await repairPhotoJobConsistency()
  await repairFaceJobConsistency()

  await cleanupDeadWorkers()

  console.log('[QueueConsistencyWorker] scan complete')
}

async function start() {
  while (!isShuttingDown) {
    const now = Date.now()

    try {
      await scanQueues()

      if (now - lastWorkerCleanupAt > 24 * 60 * 60 * 1000) {
        await cleanupOldWorkerMetrics()
        lastWorkerCleanupAt = now
      }
    } catch (error) {
      console.error('[QueueConsistencyWorker] scan failed:', error)
    }

        if (isShuttingDown) {
      break
    }

    await sleep(POLL_INTERVAL)
  }

  console.log('[QueueConsistencyWorker] graceful shutdown complete')
}

start().catch((error) => {
  console.error('[QueueConsistencyWorker] fatal:', error)
  process.exit(1)
})