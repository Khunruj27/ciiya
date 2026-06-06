import { config } from 'dotenv'

config({ path: '.env.local' })

import path from 'path'
import { createClient } from '@supabase/supabase-js'
import * as faceapi from '@vladmandic/face-api'
import canvas from 'canvas'
import WebSocket from 'ws'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const FACE_WORKER_POLL_INTERVAL = Number(
  process.env.FACE_WORKER_POLL_INTERVAL || 2000
)

const FACE_WORKER_LIMIT = Number(process.env.FACE_WORKER_LIMIT || 1)
const FACE_SCAN_ENABLED = process.env.FACE_SCAN_ENABLED !== 'false'

const FACE_JOB_CLAIM_BATCH = Number(
  process.env.FACE_JOB_CLAIM_BATCH || FACE_WORKER_LIMIT * 4
)
const FACE_JOB_MAX_PER_ALBUM = Number(process.env.FACE_JOB_MAX_PER_ALBUM || 1)

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

console.log('Face worker started')
console.log('[FaceWorker] MODE = SSD Mobilenet')
console.log('[FaceWorker] FACE_SCAN_ENABLED =', FACE_SCAN_ENABLED)
console.log('[FaceWorker] FACE_WORKER_LIMIT =', FACE_WORKER_LIMIT)
console.log('[FaceWorker] FACE_JOB_CLAIM_BATCH =', FACE_JOB_CLAIM_BATCH)
console.log('[FaceWorker] FACE_JOB_MAX_PER_ALBUM =', FACE_JOB_MAX_PER_ALBUM)
console.log('[FaceWorker] POLL_INTERVAL =', FACE_WORKER_POLL_INTERVAL)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendHeartbeat() {
  try {
    const workerId = `face-worker-${process.pid}`

    const { error } = await supabase.from('worker_heartbeats').upsert(
      {
        worker_id: workerId,
        worker_name: workerId,
        worker_type: 'face',
        status: 'online',
        last_seen: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        metadata: {
          pid: process.pid,
          node: process.version,
          mode: 'ssd_mobilenetv1',
          pollInterval: FACE_WORKER_POLL_INTERVAL,
          workerLimit: FACE_WORKER_LIMIT,
          claimBatch: FACE_JOB_CLAIM_BATCH,
          maxPerAlbum: FACE_JOB_MAX_PER_ALBUM,
          faceScanEnabled: FACE_SCAN_ENABLED,
        },
        meta: {
          pid: process.pid,
          node: process.version,
          mode: 'ssd_mobilenetv1',
          pollInterval: FACE_WORKER_POLL_INTERVAL,
          workerLimit: FACE_WORKER_LIMIT,
          claimBatch: FACE_JOB_CLAIM_BATCH,
          maxPerAlbum: FACE_JOB_MAX_PER_ALBUM,
          faceScanEnabled: FACE_SCAN_ENABLED,
        },
      },
      { onConflict: 'worker_id' }
    )

    if (error) {
      console.error('[FaceWorker] heartbeat failed:', error.message)
    }
  } catch (error) {
    console.error('[FaceWorker] heartbeat error:', error)
  }
}

async function loadFaceModels() {
  if (faceModelsLoaded) return

  const modelPath = path.join(process.cwd(), 'public', 'models')

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath)
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath)
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath)

  faceModelsLoaded = true

  console.log('[FaceWorker] SSD Mobilenet face models loaded')
}

async function updatePhoto(photoId: string, payload: Record<string, unknown>) {
  const { error } = await supabase
    .from('photos')
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photoId)

  if (error) {
    console.error('[FaceWorker] update photo failed:', error.message)
  }
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
    await supabase.from('worker_logs').insert({
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
  } catch {
    // ignore log error
  }
}

async function getPhotoForJob(job: Partial<PhotoJob>){
  if (!job.photo_id) return null

  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('id', job.photo_id)
    .maybeSingle()

  if (error) throw new Error(error.message)

  return data
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

  const { error } = await supabase
    .from('face_jobs')
    .update({
      album_id: albumId,
      owner_id: ownerId,
      image_path: imagePath,
      image_url: imageUrl,
    })
    .eq('id', job.id)

  if (error) {
    console.error('[FaceWorker] fix face job failed:', error.message)
  }

    return {
    ...job,
    album_id: albumId,
    owner_id: ownerId,
    image_path: imagePath,
    image_url: imageUrl,
  }
}

async function markFaceJobDone(job: PhotoJob){
  const { error } = await supabase
    .from('face_jobs')
    .update({
      status: 'done',
      progress: 100,
      finished_at: new Date().toISOString(),
      error: null,
    })
    .eq('id', job.id)

  if (error) {
    console.error('[FaceWorker] mark done failed:', error.message)
  }
}

async function markFaceJobFailedOrRetry(
  job: PhotoJob,
  message: string
) {
  const retryCount = Number(job.retry_count || 0)
  const maxRetries = 3
  const shouldRetry = retryCount < maxRetries

  await logWorkerError(job, message, {
    stage: 'face_worker',
    retryCount,
    willRetry: shouldRetry,
    imagePath: job.image_path,
  })

  await supabase
    .from('face_jobs')
    .update({
      status: shouldRetry ? 'pending' : 'failed',
      progress: 0,
      retry_count: retryCount + 1,
      retries: retryCount + 1,
      error: message,
      started_at: null,
      finished_at: shouldRetry ? null : new Date().toISOString(),
    })
    .eq('id', job.id)

  if (job.photo_id) {
    await updateFaceProgress(
      job.photo_id,
      shouldRetry ? 0 : 100,
      shouldRetry ? 'pending' : 'failed',
      {
        face_scan_error: message,
        faces_count: 0,
      }
    )
  }
}

async function recoverStaleFaceJobs() {
  const staleSince = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('face_jobs')
    .update({
      status: 'pending',
      progress: 0,
      error: 'Recovered stale face processing job',
      retry_count: 0,
      started_at: null,
      finished_at: null,
    })
    .eq('status', 'processing')
    .lt('started_at', staleSince)

  if (error) {
    console.error('[FaceWorker] recover stale failed:', error.message)
  }
}

async function scanFaces(buffer: Buffer) {
  await loadFaceModels()

  const img = await canvas.loadImage(buffer)

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
}

async function clusterAlbumFaces(albumId: string | null, ownerId: string | null) {
  if (!albumId || !ownerId) return

  try {
    const { data: faces, error } = await supabase
      .from('photo_faces')
      .select('id, photo_id, album_id, owner_id, descriptor')
      .eq('album_id', albumId)
      .eq('owner_id', ownerId)

    if (error) {
      console.error('[FaceWorker] cluster load faces failed:', error.message)
      return
    }

    if (!faces || faces.length === 0) return

    await supabase
      .from('face_clusters')
      .delete()
      .eq('album_id', albumId)
      .eq('owner_id', ownerId)

    await supabase
      .from('photo_faces')
      .update({
        cluster_id: null,
        person_cluster_id: null,
      })
      .eq('album_id', albumId)
      .eq('owner_id', ownerId)

    const threshold = Number(process.env.FACE_CLUSTER_THRESHOLD || 0.6)
    const clusters: {
  center: number[]
  items: FaceRow[]
}[] = []
    

    for (const face of faces) {
      const vector = Array.isArray(face.descriptor)
        ? face.descriptor.map(Number)
        : typeof face.descriptor === 'string'
          ? JSON.parse(face.descriptor).map(Number)
          : null

      if (!Array.isArray(vector)) continue

      let matchedCluster: {
  center: number[]
  items: FaceRow[]
} | null = null

      for (const cluster of clusters) {
        const distance = Math.sqrt(
          vector.reduce((sum, value, index) => {
            return sum + (value - cluster.center[index]) ** 2
          }, 0)
        )

        if (distance < threshold) {
          matchedCluster = cluster
          break
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

      const { data: createdCluster, error: clusterError } = await supabase
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

      if (clusterError || !createdCluster) {
        console.error(
          '[FaceWorker] create cluster failed:',
          clusterError?.message || 'No cluster returned'
        )
        continue
      }

      const faceIds = cluster.items.map((item) => item.id)

      const { error: updateError } = await supabase
        .from('photo_faces')
        .update({
          cluster_id: createdCluster.id,
          person_cluster_id: createdCluster.id,
        })
        .in('id', faceIds)

      if (updateError) {
        console.error('[FaceWorker] update cluster faces failed:', updateError.message)
      }
    }

    console.log(
      `[FaceWorker] clustered album=${albumId} clusters=${clusters.length} faces=${faces.length}`
    )
  } catch (error) {
    console.error('[FaceWorker] cluster album error:', error)
  }
}

async function processFaceJob(rawJob: PhotoJob) {
  let job = rawJob

  try {
    console.log('[FaceWorker] processing:', job.id)

    const photo = await getPhotoForJob(job)
    job = await fixFaceJobFromPhoto(job, photo)

    if (!FACE_SCAN_ENABLED) {
      await updateFaceProgress(job.photo_id, 100, 'skipped', {
        faces_count: 0,
        face_scan_error: 'FACE_SCAN_ENABLED is false',
      })

      await markFaceJobDone(job)
      return
    }

    if (!job.photo_id) throw new Error('Missing photo_id')
    if (!job.image_path) throw new Error('Missing image_path')

    await updateFaceProgress(job.photo_id, 10, 'processing', {
      face_scan_error: null,
      faces_count: 0,
    })

    const { data: imageFile, error: downloadError } = await supabase.storage
      .from('albums')
      .download(job.image_path)

    if (downloadError || !imageFile) {
      throw new Error(downloadError?.message || `Cannot download ${job.image_path}`)
    }

    await updateFaceProgress(job.photo_id, 30, 'processing')

    const buffer = Buffer.from(await imageFile.arrayBuffer())
    const detections = await scanFaces(buffer)

    await updateFaceProgress(job.photo_id, 70, 'processing')

    await supabase.from('photo_faces').delete().eq('photo_id', job.photo_id)

    if (detections.length > 0) {
      const rows = (detections as FaceDetectionResult[]).map((detection, index) => ({
        photo_id: job.photo_id,
        album_id: job.album_id,
        owner_id: job.owner_id,
        face_index: index,
        confidence: Number(detection.detection.score || 0),
        box_x: detection.detection.box.x,
        box_y: detection.detection.box.y,
        box_width: detection.detection.box.width,
        box_height: detection.detection.box.height,
        x: detection.detection.box.x,
        y: detection.detection.box.y,
        width: detection.detection.box.width,
        height: detection.detection.box.height,
        descriptor: Array.from(detection.descriptor),
        person_cluster_id: null,
        cluster_id: null,
      }))

      const { error } = await supabase.from('photo_faces').insert(rows)

      if (error) throw new Error(error.message)
    }

    await updateFaceProgress(job.photo_id, 100, 'done', {
      faces_count: detections.length,
      face_scan_error: null,
    })

    await markFaceJobDone(job)

    if (detections.length > 0) {
      await clusterAlbumFaces(job.album_id, job.owner_id)
    }

    console.log(`[FaceWorker] done: ${job.id} faces=${detections.length}`)

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Face scan failed'

    console.error('[FaceWorker] failed:', job.id, message)
    await markFaceJobFailedOrRetry(job, message)
  }
}

async function pollFaceJobs() {
  await recoverStaleFaceJobs()

  const { data: jobs, error } = await supabase.rpc('claim_face_jobs', {
    claim_limit: FACE_WORKER_LIMIT,
    claim_batch: FACE_JOB_CLAIM_BATCH,
    max_per_album: FACE_JOB_MAX_PER_ALBUM,
  })

  if (error) {
    console.error('[FaceWorker] claim rpc error:', error.message)
    return
  }

  if (!jobs || jobs.length === 0) {
    console.log('[FaceWorker] no pending face jobs')
    return
  }

  console.log(
    `[FaceWorker] claimed ${jobs.length} face job(s) with distributed lock`
  )

  await Promise.allSettled(
  (jobs as PhotoJob[]).map((job) =>
    processFaceJob(job)
  )
)
}

async function start() {
  while (true) {
    try {
      await sendHeartbeat()
      await pollFaceJobs()
    } catch (error) {
      console.error('[FaceWorker] loop error:', error)
    }

    await sleep(FACE_WORKER_POLL_INTERVAL)
  }
}

start().catch((error) => {
  console.error('[FaceWorker] fatal:', error)
  process.exit(1)
})