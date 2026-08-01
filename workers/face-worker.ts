import { config } from 'dotenv'

config({ path: '.env.local' })

import path from 'path'
import { createClient } from '@supabase/supabase-js'
import * as faceapi from '@vladmandic/face-api'
import canvas from 'canvas'
import WebSocket from 'ws'

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const FACE_WORKER_POLL_INTERVAL =
  getSafeIntegerEnv(
    process.env.FACE_WORKER_POLL_INTERVAL,
    2000,
    250,
    60_000
  )

const FACE_WORKER_LIMIT = getSafeIntegerEnv(
  process.env.FACE_WORKER_LIMIT,
  1,
  1,
  16
)

const FACE_SCAN_ENABLED =
  process.env.FACE_SCAN_ENABLED !== 'false'

const FACE_JOB_CLAIM_BATCH =
  getSafeIntegerEnv(
    process.env.FACE_JOB_CLAIM_BATCH,
    FACE_WORKER_LIMIT * 4,
    1,
    100
  )

const FACE_JOB_MAX_PER_ALBUM =
  getSafeIntegerEnv(
    process.env.FACE_JOB_MAX_PER_ALBUM,
    1,
    1,
    100
  )

  const WORKER_ID =
  `face-worker-${process.pid}`

type PhotoJob = {
  id: string
  photo_id: string
  album_id: string | null
  owner_id: string | null
  image_path?: string | null
  image_url?: string | null
  retry_count?: number | null
}

type PhotoRecord = {
  album_id?: string | null
  owner_id?: string | null
  user_id?: string | null
  hd_path?: string | null
  preview_path?: string | null
  storage_path?: string | null
  original_path?: string | null
  hd_url?: string | null
  preview_url?: string | null
  thumbnail_url?: string | null
  public_url?: string | null
  original_url?: string | null
  image_url?: string | null
}

type FaceRow = {
  id: string
  photo_id: string
  descriptor: number[] | string
}

type FaceDetectionResult = {
  detection: {
    score: number
    box: {
      x: number
      y: number
      width: number
      height: number
    }
  }
  descriptor: Float32Array
}

type ValidatedFaceRow = {
  photo_id: string
  album_id: string
  owner_id: string
  face_index: number
  confidence: number
  box_x: number
  box_y: number
  box_width: number
  box_height: number
  x: number
  y: number
  width: number
  height: number
  descriptor: number[]
  person_cluster_id: null
  cluster_id: null
}

class FaceJobOwnershipLostError extends Error {
  constructor(jobId: string) {
    super(
      `Face job ownership lost: ${jobId}`
    )

    this.name = 'FaceJobOwnershipLostError'
  }
}

function isFaceJobOwnershipLostError(
  error: unknown
): error is FaceJobOwnershipLostError {
  return (
    error instanceof FaceJobOwnershipLostError
  )
}


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

const { Canvas, Image, ImageData } = canvas

faceapi.env.monkeyPatch({
  Canvas: Canvas as unknown as typeof globalThis.HTMLCanvasElement,
  Image: Image as unknown as typeof globalThis.HTMLImageElement,
  ImageData: ImageData as unknown as typeof globalThis.ImageData,
})

let faceModelsLoaded = false
let faceModelsLoadingPromise: Promise<void> | null = null

let lastMetricsAt = 0
let lastRecoverAt = 0

let processedJobsCount = 0
let failedJobsCount = 0
let totalProcessingMs = 0

let isShuttingDown = false
let activeJobsCount = 0

const wakeSleepers = new Set<() => void>()
const clusteringAlbums =
  new Set<string>()

console.log('Face worker started')
console.log('[FaceWorker] MODE = SSD Mobilenet')
console.log('[FaceWorker] FACE_SCAN_ENABLED =', FACE_SCAN_ENABLED)
console.log('[FaceWorker] FACE_WORKER_LIMIT =', FACE_WORKER_LIMIT)
console.log('[FaceWorker] FACE_JOB_CLAIM_BATCH =', FACE_JOB_CLAIM_BATCH)
console.log('[FaceWorker] FACE_JOB_MAX_PER_ALBUM =', FACE_JOB_MAX_PER_ALBUM)
console.log('[FaceWorker] POLL_INTERVAL =', FACE_WORKER_POLL_INTERVAL)

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

function getValidFaceDescriptor(
  descriptor: Float32Array
) {
  const values = Array.from(
    descriptor,
    Number
  )

  if (values.length !== 128) {
    return null
  }

  if (
    values.some(
      (value) => !Number.isFinite(value)
    )
  ) {
    return null
  }

  return values
}

function requestShutdown(signal: string) {
  if (isShuttingDown) return

  isShuttingDown = true

  console.log(
    `[FaceWorker] received ${signal}, waiting for ${activeJobsCount} active job(s)`
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
  baseDelay = 1200
): Promise<T> {
  let lastError: unknown

  for (
    let attempt = 1;
    attempt <= retries;
    attempt += 1
  ) {
    if (isShuttingDown) {
      throw new Error(
        'Worker is shutting down'
      )
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
        `[FaceWorker] retry ${attempt}/${retries} failed:`,
        error instanceof Error
          ? error.message
          : error
      )

      if (
        attempt < retries &&
        !isShuttingDown
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

async function sendHeartbeat() {
  try {
    await withRetry(() =>
      supabase
        .from('worker_heartbeats')
        .upsert(
          {
            worker_id: WORKER_ID,
            worker_name: WORKER_ID,
            worker_type: 'face',
            status: 'online',
            last_seen:
              new Date().toISOString(),
            last_seen_at:
              new Date().toISOString(),
            metadata: {
              pid: process.pid,
              node: process.version,
              mode: 'ssd_mobilenetv1',
              pollInterval:
                FACE_WORKER_POLL_INTERVAL,
              workerLimit:
                FACE_WORKER_LIMIT,
              claimBatch:
                FACE_JOB_CLAIM_BATCH,
              maxPerAlbum:
                FACE_JOB_MAX_PER_ALBUM,
              faceScanEnabled:
                FACE_SCAN_ENABLED,
            },
            meta: {
              pid: process.pid,
              node: process.version,
              mode: 'ssd_mobilenetv1',
              pollInterval:
                FACE_WORKER_POLL_INTERVAL,
              workerLimit:
                FACE_WORKER_LIMIT,
              claimBatch:
                FACE_JOB_CLAIM_BATCH,
              maxPerAlbum:
                FACE_JOB_MAX_PER_ALBUM,
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
      '[FaceWorker] heartbeat failed:',
      error instanceof Error
        ? error.message
        : error
    )
  }
}

async function markWorkerOffline() {
  try {
    await withRetry(() =>
      supabase
        .from('worker_heartbeats')
        .update({
          status: 'offline',
          last_seen: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        })
        .eq('worker_id', WORKER_ID)
    )
  } catch (error) {
    console.error(
      '[FaceWorker] mark offline failed:',
      error instanceof Error
        ? error.message
        : error
    )
  }
}

async function loadFaceModels() {
  if (faceModelsLoaded) {
    return
  }

  if (faceModelsLoadingPromise) {
    return faceModelsLoadingPromise
  }

  const modelPath = path.join(
    process.cwd(),
    'public',
    'models'
  )

  faceModelsLoadingPromise = (async () => {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(
      modelPath
    )

    await faceapi.nets.faceLandmark68Net.loadFromDisk(
      modelPath
    )

    await faceapi.nets.faceRecognitionNet.loadFromDisk(
      modelPath
    )

    faceModelsLoaded = true

    console.log(
      '[FaceWorker] SSD Mobilenet face models loaded'
    )
  })()

  try {
    await faceModelsLoadingPromise
  } finally {
    faceModelsLoadingPromise = null
  }
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
  job: Partial<PhotoJob>,
  message: string,
  meta: Record<string, unknown> = {}
) {
  try {
    await withRetry(() =>
      supabase.from('worker_logs').insert({
        job_id: job?.id || null,
        photo_id: job?.photo_id || null,
        owner_id: job?.owner_id || null,
        album_id: job?.album_id || null,
        worker_type: 'face',
        level: 'error',
        message,
        metadata: meta,
        meta,
      })
    )
  } catch {
    // Logging must never interrupt the main face-job failure flow.
  }
}

async function getPhotoForJob(job: Partial<PhotoJob>){
  if (!job.photo_id) return null

  const result = await withRetry(() =>
  supabase
    .from('photos')
    .select('*')
    .eq('id', job.photo_id)
    .maybeSingle()
)

return result.data
}

async function assertFaceJobStillOwned(
  job: PhotoJob
) {
  const result = await withRetry(() =>
    supabase
      .from('face_jobs')
      .select(
        'id,status,worker_id,claimed_by'
      )
      .eq('id', job.id)
      .maybeSingle()
  )

  const currentJob = result.data

  if (
    !currentJob ||
    currentJob.status !== 'processing' ||
    currentJob.worker_id !== WORKER_ID ||
    currentJob.claimed_by !== WORKER_ID
  ) {
    throw new FaceJobOwnershipLostError(
      job.id
    )
  }
}

async function fixFaceJobFromPhoto(
  job: PhotoJob,
  photo: PhotoRecord | null
): Promise<PhotoJob> {
  const imagePath =
    job.image_path ||
    photo?.hd_path ||
    photo?.preview_path ||
    photo?.storage_path ||
    photo?.original_path ||
    null

  const imageUrl =
    job.image_url ||
    photo?.hd_url ||
    photo?.preview_url ||
    photo?.thumbnail_url ||
    photo?.public_url ||
    photo?.original_url ||
    photo?.image_url ||
    null

    
  const albumId = job.album_id || photo?.album_id || null
  const ownerId = job.owner_id || photo?.owner_id || photo?.user_id || null

const repairResult = await withRetry(() =>
  supabase
    .from('face_jobs')
    .update({
      album_id: albumId,
      owner_id: ownerId,
      image_path: imagePath,
      image_url: imageUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('status', 'processing')
    .eq('worker_id', WORKER_ID)
    .eq('claimed_by', WORKER_ID)
    .select('id')
    .maybeSingle()
)

if (!repairResult.data) {
  throw new FaceJobOwnershipLostError(
    job.id
  )
}

    return {
    ...job,
    album_id: albumId,
    owner_id: ownerId,
    image_path: imagePath,
    image_url: imageUrl,
  }
}

async function markFaceJobDone(
  job: PhotoJob
) {
  const result = await withRetry(() =>
    supabase
      .from('face_jobs')
      .update({
        status: 'done',
        progress: 100,
        finished_at:
          new Date().toISOString(),
        error: null,
        worker_id: null,
        claimed_by: null,
        updated_at:
          new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'processing')
      .eq('worker_id', WORKER_ID)
      .eq('claimed_by', WORKER_ID)
      .select('id')
      .maybeSingle()
  )

  if (!result.data) {
    console.warn(
      '[FaceWorker] mark done skipped because claim ownership was lost:',
      job.id
    )

    return false
  }

  return true
}

async function markFaceJobFailedOrRetry(
  job: PhotoJob,
  message: string
) {
  const retryCount = Number(
    job.retry_count ?? 0
  )

  const normalizedRetryCount =
    Number.isSafeInteger(retryCount) &&
    retryCount >= 0
      ? retryCount
      : 0

  const maxRetries = 3

  const shouldRetry =
    normalizedRetryCount < maxRetries

  await logWorkerError(job, message, {
    stage: 'face_worker',
    retryCount: normalizedRetryCount,
    willRetry: shouldRetry,
    imagePath: job.image_path,
  })

  const result = await withRetry(() =>
    supabase
      .from('face_jobs')
      .update({
        status: shouldRetry
          ? 'pending'
          : 'failed',
        progress: 0,
        retry_count:
          normalizedRetryCount + 1,
        retries:
          normalizedRetryCount + 1,
        error: message,
        worker_id: null,
        claimed_by: null,
        started_at: null,
        finished_at: shouldRetry
          ? null
          : new Date().toISOString(),
        updated_at:
          new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'processing')
      .eq('worker_id', WORKER_ID)
      .eq('claimed_by', WORKER_ID)
      .select('id')
      .maybeSingle()
  )

  if (!result.data) {
    console.warn(
      '[FaceWorker] retry/failure update skipped because claim ownership was lost:',
      job.id
    )

    return false
  }

  if (job.photo_id) {
    await updateFaceProgress(
      job.photo_id,
      shouldRetry ? 0 : 100,
      shouldRetry
        ? 'pending'
        : 'failed',
      {
        face_scan_error: message,
        faces_count: 0,
      }
    )
  }

  return true
}

async function recoverStaleFaceJobs() {
  const staleSince = new Date(Date.now() - 15 * 60 * 1000).toISOString()

await withRetry(() =>
  supabase
    .from('face_jobs')
    .update({
      status: 'pending',
      progress: 0,
      error: 'Recovered stale face processing job',

      worker_id: null,
      claimed_by: null,

      started_at: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'processing')
    .lt('started_at', staleSince)
)
}

async function scanFaces(buffer: Buffer) {
  await loadFaceModels()

  const img = await canvas.loadImage(buffer)

  try {
    const detections = await faceapi
      .detectAllFaces(
        img as unknown as HTMLImageElement,
        new faceapi.SsdMobilenetv1Options({
          minConfidence: 0.45,
        })
      )
      .withFaceLandmarks()
      .withFaceDescriptors()

    return detections
  } finally {
    img.src = ''

    img.onload = null
    img.onerror = null
  }
}

function getClusterDescriptor(
  value: unknown
): number[] | null {
  let parsed: unknown = null

  if (Array.isArray(value)) {
    parsed = value
  } else if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }

  if (!Array.isArray(parsed)) {
    return null
  }

  if (parsed.length !== 128) {
    return null
  }

  const descriptor = parsed.map(Number)

  if (
    descriptor.some(
      (item) => !Number.isFinite(item)
    )
  ) {
    return null
  }

  return descriptor
}



async function clusterAlbumFaces(
  albumId: string | null,
  ownerId: string | null
) {
  if (!albumId || !ownerId) {
    return
  }
  

  const lockKey = `${ownerId}:${albumId}`

if (clusteringAlbums.has(lockKey)) {
  console.log(
    `[FaceWorker] clustering skipped (already running): ${lockKey}`
  )
  return
}

  clusteringAlbums.add(lockKey)

  try {
 const { data: faces, error } = await withRetry(() =>
  supabase
    .from("photo_faces")
    .select("id, photo_id, descriptor")
    .eq("album_id", albumId)
    .eq("owner_id", ownerId),
);

    if (error) {
      console.error('[FaceWorker] cluster load faces failed:', error.message)
      return
    }

    if (!faces || faces.length === 0) return

    await withRetry(() =>
  supabase
    .from('face_clusters')
    .delete()
    .eq('album_id', albumId)
    .eq('owner_id', ownerId)
)

   await withRetry(() =>
  supabase
    .from('photo_faces')
    .update({
      cluster_id: null,
      person_cluster_id: null,
    })
    .eq('album_id', albumId)
    .eq('owner_id', ownerId)
)

const threshold =
  getSafeIntegerEnv(
    process.env.FACE_CLUSTER_THRESHOLD,
    52,
    20,
    95
  ) / 100

const thresholdSquared =
  threshold * threshold

const clusters: {
  center: number[];
  items: FaceRow[];
}[] = [];
    

    for (const face of faces) {
     const vector =
  getClusterDescriptor(
    face.descriptor
  )

if (!vector) {
  console.warn(
    '[FaceWorker] invalid cluster descriptor skipped:',
    {
      faceId: face.id,
      photoId: face.photo_id,
      albumId,
    }
  )

  continue
}

      let matchedCluster: {
  center: number[]
  items: FaceRow[]
} | null = null

      for (const cluster of clusters) {
  let distanceSquared = 0;

  for (let index = 0; index < vector.length; index += 1) {
    const difference = vector[index] - cluster.center[index];
    distanceSquared += difference * difference;

    if (distanceSquared >= thresholdSquared) {
      break;
    }
  }

  if (distanceSquared < thresholdSquared) {
    matchedCluster = cluster;
    break;
  }
}

      if (matchedCluster) {
        matchedCluster.items.push(face)

        const total = matchedCluster.items.length
        matchedCluster.center = matchedCluster.center.map((value, index) => {
          return value + (vector[index] - value) / total
        })
      } else {
        clusters.push({
          center: vector,
          items: [face],
        })
      }
    }

    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index]
      const previewPhotoId = cluster.items[0]?.photo_id || null

      const { data: createdCluster, error: clusterError } = await withRetry(() =>
  supabase
    .from('face_clusters')
    .insert({
      album_id: albumId,
      owner_id: ownerId,
      label: `Person ${index + 1}`,
      preview_photo_id: previewPhotoId,
      face_count: cluster.items.length,
    })
    .select('id')
    .single()
)

      if (clusterError || !createdCluster) {
        console.error(
          '[FaceWorker] create cluster failed:',
          clusterError?.message || 'No cluster returned'
        )
        continue
      }

      const faceIds = cluster.items.map((item) => item.id)

     const { error: updateError } = await withRetry(() =>
  supabase
    .from('photo_faces')
    .update({
      cluster_id: createdCluster.id,
      person_cluster_id: createdCluster.id,
    })
    .in('id', faceIds)
)

      if (updateError) {
        console.error('[FaceWorker] update cluster faces failed:', updateError.message)
      }
    }

    console.log(
      `[FaceWorker] clustered album=${albumId} clusters=${clusters.length} faces=${faces.length}`
    )
 } catch (error) {
    console.error(
      '[FaceWorker] cluster album error:',
      error
    )
} finally {
    clusteringAlbums.delete(lockKey)
}
}

async function processFaceJob(
  rawJob: PhotoJob
) {
  activeJobsCount += 1

  let job = rawJob

  try {
    console.log(
      '[FaceWorker] processing:',
      job.id
    )

    const startedAt = Date.now()

    const photo = await getPhotoForJob(job)

    job = await fixFaceJobFromPhoto(
      job,
      photo
    )

    if (!FACE_SCAN_ENABLED) {
      await assertFaceJobStillOwned(job)

      await updateFaceProgress(
        job.photo_id,
        100,
        'skipped',
        {
          faces_count: 0,
          face_scan_error:
            'FACE_SCAN_ENABLED is false',
        }
      )

      const jobMarkedDone =
        await markFaceJobDone(job)

      if (!jobMarkedDone) {
        return
      }

      processedJobsCount += 1
      totalProcessingMs +=
        Date.now() - startedAt

      return
    }

    if (!job.photo_id) {
      throw new Error('Missing photo_id')
    }

    if (!job.image_path) {
      throw new Error('Missing image_path')
    }

    if (!job.album_id) {
      throw new Error('Missing album_id')
    }

    if (!job.owner_id) {
      throw new Error('Missing owner_id')
    }

    const imagePath = String(
      job.image_path
    )

    const allowedPrefix =
      `${job.owner_id}/${job.album_id}/`

    if (
      hasUnsafeStoragePath(imagePath) ||
      !(
        imagePath.startsWith(
          `${allowedPrefix}hd/`
        ) ||
        imagePath.startsWith(
          `${allowedPrefix}preview/`
        ) ||
        imagePath.startsWith(
          `${allowedPrefix}original/`
        )
      )
    ) {
      throw new Error('Invalid image_path')
    }

    await updateFaceProgress(
      job.photo_id,
      10,
      'processing',
      {
        face_scan_error: null,
        faces_count: 0,
      }
    )

    const {
      data: imageFile,
      error: downloadError,
    } = await withRetry(() =>
      supabase.storage
        .from('albums')
        .download(imagePath)
    )

    if (downloadError || !imageFile) {
      throw new Error(
        downloadError?.message ||
          `Cannot download ${imagePath}`
      )
    }

    await updateFaceProgress(
      job.photo_id,
      30,
      'processing'
    )

    const buffer = Buffer.from(
      await imageFile.arrayBuffer()
    )

    let detections: Awaited<
      ReturnType<typeof scanFaces>
    >

    try {
      detections = await scanFaces(buffer)
    } finally {
      buffer.fill(0)
    }

    if (detections.length === 0) {
      console.log(
        `[FaceWorker] no face detected ${job.photo_id}`
      )
    }

    await updateFaceProgress(
      job.photo_id,
      70,
      'processing'
    )

    const rows: ValidatedFaceRow[] = []

    for (
      const [index, detection] of (
        detections as FaceDetectionResult[]
      ).entries()
    ) {
      const descriptor =
        getValidFaceDescriptor(
          detection.descriptor
        )

      const confidence = Number(
        detection.detection.score
      )

      const boxX = Number(
        detection.detection.box.x
      )

      const boxY = Number(
        detection.detection.box.y
      )

      const boxWidth = Number(
        detection.detection.box.width
      )

      const boxHeight = Number(
        detection.detection.box.height
      )

      if (
        !descriptor ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1 ||
        !Number.isFinite(boxX) ||
        !Number.isFinite(boxY) ||
        !Number.isFinite(boxWidth) ||
        !Number.isFinite(boxHeight) ||
        boxWidth <= 0 ||
        boxHeight <= 0
      ) {
        console.warn(
          '[FaceWorker] invalid face detection skipped:',
          {
            jobId: job.id,
            photoId: job.photo_id,
            faceIndex: index,
          }
        )

        continue
      }

      rows.push({
        photo_id: job.photo_id,
        album_id: job.album_id,
        owner_id: job.owner_id,
        face_index: index,
        confidence,
        box_x: boxX,
        box_y: boxY,
        box_width: boxWidth,
        box_height: boxHeight,
        x: boxX,
        y: boxY,
        width: boxWidth,
        height: boxHeight,
        descriptor,
        person_cluster_id: null,
        cluster_id: null,
      })
    }

    /*
     * ตรวจ claim หลังงาน AI ที่ใช้เวลานาน
     * และก่อนแก้ไขข้อมูลใบหน้าเดิม
     */
    await assertFaceJobStillOwned(job)

    await withRetry(() =>
      supabase
        .from('photo_faces')
        .delete()
        .eq('photo_id', job.photo_id)
        .eq('album_id', job.album_id)
        .eq('owner_id', job.owner_id)
    )

    if (rows.length > 0) {
      /*
       * ตรวจซ้ำก่อนเขียนชุดข้อมูลใหม่
       * เผื่อ claim ถูกยกเลิกหลัง delete
       */
      await assertFaceJobStillOwned(job)

      await withRetry(() =>
        supabase
          .from('photo_faces')
          .insert(rows)
      )
    }

    await assertFaceJobStillOwned(job)

    await updateFaceProgress(
      job.photo_id,
      100,
      'done',
      {
        faces_count: rows.length,
        face_scan_error: null,
      }
    )

    const jobMarkedDone =
      await markFaceJobDone(job)

    if (!jobMarkedDone) {
      return
    }

    /*
     * Clustering ต้องทำหลัง insert rows
     * และหลัง Face Job commit สำเร็จ
     */
    if (rows.length > 0) {
      await clusterAlbumFaces(
        job.album_id,
        job.owner_id
      )
    }

    processedJobsCount += 1
    totalProcessingMs +=
      Date.now() - startedAt

    console.log(
      `[FaceWorker] done: ${job.id} faces=${rows.length}`
    )
  } catch (error) {
    if (
      isFaceJobOwnershipLostError(error)
    ) {
      console.warn(
        '[FaceWorker] job stopped because claim ownership was lost:',
        job.id
      )

      return
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Face scan failed'

    console.error(
      '[FaceWorker] failed:',
      job.id,
      message
    )

    const failureRecorded =
      await markFaceJobFailedOrRetry(
        job,
        message
      )

    if (failureRecorded) {
      failedJobsCount += 1
    }
  } finally {
    activeJobsCount = Math.max(
      0,
      activeJobsCount - 1
    )
  }
}


async function pollFaceJobs() {
  if (isShuttingDown) {
    return
  }

  const workerName = WORKER_ID

  const claimResults = await Promise.allSettled(
    Array.from({ length: FACE_WORKER_LIMIT }).map(() =>
      withRetry(() =>
  supabase.rpc('claim_next_face_job', {
    worker_name: workerName,
  })
)
    )
  )

  const jobs: PhotoJob[] = []

  for (const result of claimResults) {
    if (result.status === 'rejected') {
      console.error('[FaceWorker] claim rpc failed:', result.reason)
      continue
    }

    if (result.value.error) {
      console.error('[FaceWorker] claim rpc error:', result.value.error.message)
      continue
    }

    const job = result.value.data?.[0]

    if (job) {
      jobs.push(job as PhotoJob)
    }
  }

  if (jobs.length === 0) {
    console.log('[FaceWorker] no pending face jobs')
    return
  }

  console.log(`[FaceWorker] claimed ${jobs.length} face job(s)`)

  await Promise.allSettled(
    jobs.map((job) => processFaceJob(job))
  )
}

let lastHeartbeatAt = 0

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
          worker_type: 'face',
          status: 'online',
          processed_jobs:
            processedJobsCount,
          failed_jobs:
            failedJobsCount,
          avg_processing_ms:
            avgProcessingMs,
          memory_mb: getMemoryMb(),
          metadata: {
            pid: process.pid,
            mode: 'ssd_mobilenetv1',
            workerLimit:
              FACE_WORKER_LIMIT,
            claimBatch:
              FACE_JOB_CLAIM_BATCH,
            maxPerAlbum:
              FACE_JOB_MAX_PER_ALBUM,
            faceScanEnabled:
              FACE_SCAN_ENABLED,
          },
          recorded_at:
            new Date().toISOString(),
        })
    )
  } catch (error) {
    console.error(
      '[FaceWorker] metrics failed:',
      error instanceof Error
        ? error.message
        : error
    )
  }
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
        await recoverStaleFaceJobs()
       lastRecoverAt = now
      }

      if (now - lastMetricsAt > 60 * 1000) {
        await sendWorkerMetrics()
        lastMetricsAt = now
      }

 await pollFaceJobs()
 if (isShuttingDown && activeJobsCount === 0) {
  await markWorkerOffline()

  console.log('[FaceWorker] graceful shutdown complete')
  process.exit(0)
}

       } catch (error) {
      console.error(
        '[FaceWorker] loop error:',
        error
      )
    }

    if (isShuttingDown) {
      continue
    }

    await sleep(
      FACE_WORKER_POLL_INTERVAL
    )
  }
}

start().catch((error) => {
  console.error(
    '[FaceWorker] fatal:',
    error
  )

  process.exit(1)
})