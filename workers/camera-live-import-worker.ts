import dotenv from 'dotenv'
import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createStorageRef,
  getR2Config,
  getStorageAdapter,
  isR2PhotoUploadEnabledForOwner,
  type StorageProvider,
} from '../src/lib/storage'
import {
  createCameraUploadPlan,
  ensureCameraUploadObject,
  hashCameraPhoto,
} from '../src/lib/storage/camera-upload'

dotenv.config({
  path: '.env.local',
})

Object.defineProperty(globalThis, 'WebSocket', {
  value: WebSocket,
  configurable: true,
  writable: true,
})

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const execFileAsync = promisify(execFile)
const GPHOTO_BIN = process.env.GPHOTO_BIN || 'gphoto2'
const CAMERA_IMPORT_TEMP_DIR =
  process.env.CAMERA_IMPORT_TEMP_DIR || '.ciiya-camera-imports'

const POLL_INTERVAL_MS = 7000
const CAMERA_DETECT_CACHE_MS = 5000

const sessionBaselines = new Map<string, Set<string>>()

let lastHeartbeatAt = 0
const HEARTBEAT_INTERVAL_MS = 30 * 1000

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase environment variables')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

type CameraUploadSession = {
  id: string
  album_id: string
  owner_id: string
  preset_path: string | null
  resize_mode: string | null
  auto_face_scan: boolean | null
  auto_publish: boolean | null
  status: string
  last_activity_at?: string | null
}

type CameraImportRow = {
  id: string
  local_path: string | null
  file_size_bytes: number | string | null
  status: string
  storage_path: string | null
  storage_provider: StorageProvider | null
  storage_bucket: string | null
  photo_upload_session_id: string | null
}

type CameraReservationRow = {
  session_id: string
  reserved_object_key: string
  reserved_storage_bucket: string
}

type DetectedCamera = {
  model: string
  port: string
}

let cachedCamera: DetectedCamera | null = null
let lastCameraDetectedAt = 0

async function getCachedCamera() {
  const now = Date.now()

  if (
    cachedCamera &&
    now - lastCameraDetectedAt < CAMERA_DETECT_CACHE_MS
  ) {
    return cachedCamera
  }

  const camera = await detectCamera()

  cachedCamera = camera
  lastCameraDetectedAt = now

  return camera
}

 type CameraFile = {
  cameraFileId: string
  filename: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendHeartbeat() {
  const now = Date.now()

  if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) {
    return
  }

  lastHeartbeatAt = now

  try {
    const workerId = `camera-worker-${process.pid}`
    const seenAt = new Date().toISOString()

    const { error } = await supabase.from('worker_heartbeats').upsert(
      {
        worker_id: workerId,
        worker_name: workerId,
        worker_type: 'camera',
        status: 'online',
        last_seen: seenAt,
        last_seen_at: seenAt,
        metadata: {
          pid: process.pid,
          node: process.version,
          pollInterval: POLL_INTERVAL_MS,
          detectCacheMs: CAMERA_DETECT_CACHE_MS,
          gphotoBin: GPHOTO_BIN,
        },
        meta: {
          pid: process.pid,
          node: process.version,
          pollInterval: POLL_INTERVAL_MS,
          detectCacheMs: CAMERA_DETECT_CACHE_MS,
          gphotoBin: GPHOTO_BIN,
        },
      },
      { onConflict: 'worker_id' }
    )

    if (error) {
      console.error('[CameraWorker] heartbeat failed:', error.message)
    }
  } catch (error) {
    console.error('[CameraWorker] heartbeat error:', error)
  }
}


async function expireInactiveSessions() {
  const timeoutAt = new Date(
    Date.now() - 30 * 60 * 1000
  ).toISOString()

  const { error } = await supabase
    .from('camera_upload_sessions')
    .update({
      status: 'stopped',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'active')
    .lt('last_activity_at', timeoutAt)

  if (error) {
    console.error(
      '[camera-live-import-worker] expire sessions:',
      error.message
    )
  }
}

async function loadActiveSessions() {
  const { data, error } = await supabase
    .from('camera_upload_sessions')
    .select(
      `
      id,
      album_id,
      owner_id,
      preset_path,
      resize_mode,
      auto_face_scan,
      auto_publish,
      status,
      last_activity_at

`)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(10)

  if (error) {
    console.error('[camera-live-import-worker] load sessions failed:', error.message)
    return []
  }

  return (data || []) as CameraUploadSession[]
}

const GPHOTO_RETRY_ATTEMPTS = 4
const GPHOTO_RETRY_DELAY_MS = 1500

function isRetryableGphotoError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  const lower = message.toLowerCase()

  return (
    lower.includes('could not claim') ||
    lower.includes('busy') ||
    lower.includes('claim the usb device') ||
    lower.includes('ptp i/o error') ||
    lower.includes('i/o in progress') ||
    lower.includes('lock the device') ||
    lower.includes('another app')
  )
}

async function execGphoto(
  args: string[],
  options: { timeout: number }
) {
  let lastError: unknown

  for (let attempt = 1; attempt <= GPHOTO_RETRY_ATTEMPTS; attempt++) {
    try {
      return await execFileAsync(GPHOTO_BIN, args, options)
    } catch (error) {
      lastError = error

      if (
        !isRetryableGphotoError(error) ||
        attempt === GPHOTO_RETRY_ATTEMPTS
      ) {
        throw error
      }

      console.warn(
        `[camera-live-import-worker] gphoto2 device busy, retrying (${attempt}/${GPHOTO_RETRY_ATTEMPTS})...`
      )

      await sleep(GPHOTO_RETRY_DELAY_MS)
    }
  }

  throw lastError
}

async function detectCamera(): Promise<DetectedCamera | null> {
  try {
    const { stdout } = await execGphoto(['--auto-detect'], {
      timeout: 5000,
    })

    
    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    const cameraLine = lines.find(
      (line) =>
        !line.startsWith('Model') &&
        !line.startsWith('-') &&
        line.includes('usb:')
    )

    if (!cameraLine) return null

    const parts = cameraLine.split(/\s{2,}/)

    return {
      model: parts[0]?.trim() || cameraLine,
      port: parts[1]?.trim() || '',
    }
  } catch (error) {
    console.error(
      '[camera-live-import-worker] detect camera failed:',
      error instanceof Error ? error.message : error
    )

    return null
  }
}

function parseCameraFiles(stdout: string): CameraFile[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .map((line) => {
      if (!line.startsWith('#')) return null

      const idMatch = line.match(/^#(\d+)/)
      if (!idMatch?.[1]) return null

      const cameraFileId = idMatch[1]

      const withoutId = line.replace(/^#\d+\s+/, '').trim()
      if (!withoutId) return null

      const tokens = withoutId.split(/\s+/)
      const filename = tokens[0]?.trim()

      if (!filename) return null

      return {
        cameraFileId,
        filename,
      }
    })
    .filter((file): file is CameraFile => Boolean(file))
}

async function listCameraJpgFiles(): Promise<CameraFile[]> {
  try {
    const { stdout } = await execGphoto(['--list-files'], {
      timeout: 10000,
    })

    return parseCameraFiles(stdout)
  } catch (error) {
    console.error(
      '[camera-live-import-worker] list camera files failed:',
      error instanceof Error ? error.message : error
    )

    return []
  }
}

async function queueCameraFile(
  session: CameraUploadSession,
  file: CameraFile
) {
  const { error } = await supabase.from('camera_live_imports').upsert(
    {
      session_id: session.id,
      album_id: session.album_id,
      owner_id: session.owner_id,
      camera_file_id: file.cameraFileId,
      filename: file.filename,
      status: 'pending',
      progress: 0,
      detected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'album_id,filename',
      ignoreDuplicates: true,
    }
  )

  if (error) {
    console.error(
      `[camera-live-import-worker] queue file failed filename=${file.filename}:`,
      error.message
    )
  }
}

// camera_file_id is just gphoto2's position in the current --list-files
// output, not a persistent identifier - it commonly changes across
// reconnects, so the same physical shot would look "new" every time.
// filename is what's actually stable for a given card.
async function getUntrackedFiles(
  session: CameraUploadSession,
  files: CameraFile[]
) {
  if (files.length === 0) return []

  const filenames = files.map((file) => file.filename)

  const { data, error } = await supabase
    .from('camera_live_imports')
    .select('filename')
    .eq('album_id', session.album_id)
    .in('filename', filenames)

  if (error) {
    console.error(
      '[camera-live-import-worker] filter existing files failed:',
      error.message
    )

    return files
  }

  const trackedFilenames = new Set(
    (data || [])
      .map((item) => String(item.filename || ''))
      .filter(Boolean)
  )

  return files.filter((file) => !trackedFilenames.has(file.filename))
}

async function filterNewCameraFiles(
  session: CameraUploadSession,
  files: CameraFile[]
) {
  return getUntrackedFiles(session, files)
}

async function getBaselineFilteredFiles(
  session: CameraUploadSession,
  files: CameraFile[]
) {
  const cachedBaseline = sessionBaselines.get(session.id)

  if (cachedBaseline) {
    return files.filter((file) => !cachedBaseline.has(file.filename))
  }

  // First poll of this session: whatever's on the card right now that
  // we've never tracked for this album before is presumed pre-existing,
  // not something the user just shot. Only files that show up in a
  // *later* poll count as new. Anything already tracked (done, pending,
  // failed, previously baseline-skipped, ...) is left untouched here -
  // filterNewCameraFiles excludes it anyway.
  const untracked = await getUntrackedFiles(session, files)

  sessionBaselines.set(
    session.id,
    new Set(untracked.map((file) => file.filename))
  )

  if (untracked.length > 0) {
    const { error: skipError } = await supabase
      .from('camera_live_imports')
      .upsert(
        untracked.map((file) => ({
          session_id: session.id,
          album_id: session.album_id,
          owner_id: session.owner_id,
          camera_file_id: file.cameraFileId,
          filename: file.filename,
          status: 'skipped_baseline',
          progress: 0,
          detected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
        {
          onConflict: 'album_id,filename',
          ignoreDuplicates: true,
        }
      )

    if (skipError) {
      console.error(
        '[camera-live-import-worker] persist baseline failed:',
        skipError.message
      )
    }
  }

  console.log(
    `[camera-live-import-worker] baseline set album=${session.album_id} files=${untracked.length}`
  )

  return []
}

async function ensureTempDir() {
  await fs.mkdir(CAMERA_IMPORT_TEMP_DIR, {
    recursive: true,
  })
}

function isSupportedCameraFile(filename: string) {
  const lower = filename.toLowerCase()

  return (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.jpe')
  )
}

function getSafeLocalFileName(filename: string) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120)
}

async function downloadCameraFile(
  session: CameraUploadSession,
  file: CameraFile
) {
  await ensureTempDir()

  const albumDir = path.join(
    CAMERA_IMPORT_TEMP_DIR,
    session.album_id
  )

  await fs.mkdir(albumDir, {
    recursive: true,
  })

  const safeName = getSafeLocalFileName(file.filename)
  const localPath = path.join(albumDir, safeName)

  try {
    await execGphoto(
      [
        '--get-file',
        file.cameraFileId,
        '--filename',
        localPath,
      ],
      {
        timeout: 30000,
      }
    )

    const stat = await fs.stat(localPath)

    await supabase
      .from('camera_live_imports')
      .update({
        local_path: localPath,
        file_size_bytes: stat.size,
        status: 'imported',
        progress: 50,
        imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('album_id', session.album_id)
      .eq('filename', file.filename)

    console.log(
      `[camera-live-import-worker] downloaded ${file.filename} -> ${localPath}`
    )
  } catch (error) {
    await supabase
      .from('camera_live_imports')
      .update({
        status: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'Download failed',
        updated_at: new Date().toISOString(),
      })
      .eq('album_id', session.album_id)
      .eq('filename', file.filename)

    console.error(
      `[camera-live-import-worker] download failed filename=${file.filename}:`,
      error instanceof Error ? error.message : error
    )
  }
}

function getUploadSafeFileName(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg'
  const baseName = filename.replace(/\.[^/.]+$/, '')

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

  return `${Date.now()}-${crypto.randomUUID()}-${safeBaseName || 'photo'}.${ext}`
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) || null
  if (value && typeof value === 'object') return value as T
  return null
}

function isStorageLimitError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error || '')

  return (
    message.toLowerCase().includes('storage full') ||
    message.toLowerCase().includes('storage limit') ||
    message.toLowerCase().includes('quota')
  )
}

class CameraFinalizeError extends Error {
  readonly cleanupSafe: boolean

  constructor(message: string, cleanupSafe = false) {
    super(message)
    this.name = 'CameraFinalizeError'
    this.cleanupSafe = cleanupSafe
  }
}

async function reserveCameraR2Upload(params: {
  session: CameraUploadSession
  importId: string
  storageBucket: string
  storagePath: string
  file: CameraFile
  fileSizeBytes: number
  fileHash: string
}) {
  const { data, error } = await supabase.rpc('reserve_camera_photo_upload', {
    p_camera_import_id: params.importId,
    p_storage_bucket: params.storageBucket,
    p_object_key: params.storagePath,
    p_original_file_name: params.file.filename,
    p_content_type: 'image/jpeg',
    p_expected_size_bytes: params.fileSizeBytes,
    p_file_hash: params.fileHash,
    p_requested_size: params.session.resize_mode || 'original',
    p_preset_path: params.session.preset_path,
    p_auto_face_scan: params.session.auto_face_scan ?? true,
    p_auto_publish: params.session.auto_publish ?? false,
  })

  if (error) {
    throw new Error(error.message)
  }

  const reservation = firstRow<CameraReservationRow>(data)

  if (
    !reservation?.session_id ||
    reservation.reserved_storage_bucket !== params.storageBucket ||
    reservation.reserved_object_key !== params.storagePath
  ) {
    throw new Error('Camera upload reservation does not match the object')
  }

  return reservation
}

async function cancelCameraR2Upload(
  uploadSessionId: string,
  cameraImportId: string
) {
  const { error } = await supabase.rpc('cancel_camera_photo_upload', {
    p_session_id: uploadSessionId,
    p_camera_import_id: cameraImportId,
  })

  if (error) {
    console.error(
      `[camera-live-import-worker] cancel reservation failed session=${uploadSessionId}:`,
      error.message
    )
  }
}

async function finalizeCameraUpload(params: {
  session: CameraUploadSession
  file: CameraFile
  storagePath: string
  fileSizeBytes: number
  fileHash: string
  storageProvider: StorageProvider
  storageBucket: string
  cameraImportId: string
  uploadSessionId: string | null
}) {
  const {
    session,
    file,
    storagePath,
    fileSizeBytes,
    fileHash,
    storageProvider,
    storageBucket,
    cameraImportId,
    uploadSessionId,
  } = params

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  console.log('[camera-worker] finalize siteUrl=', siteUrl)

  const res = await fetch(`${siteUrl}/api/photos/finalize-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': String(process.env.WORKER_SECRET || '').trim(),
    },
    body: JSON.stringify({
      albumId: session.album_id,
      storagePath,
      fileName: file.filename,
      fileHash,
      fileSizeBytes,
      storageProvider,
      storageBucket,
      uploadSessionId,
      cameraImportId,
      size: session.resize_mode || 'original',
      categoryId: null,
      presetPath: session.preset_path,
      autoFaceScan: session.auto_face_scan ?? true,
      autoPublish: session.auto_publish ?? false,
    }),
  })

  const json = await res.json().catch(() => null)

  if (!res.ok || !json?.success) {
    throw new CameraFinalizeError(
      json?.error || json?.jobError || 'Finalize upload failed',
      json?.cleanupSafe === true
    )
  }

  return json
}

async function uploadLocalCameraFile(
  session: CameraUploadSession,
  file: CameraFile
) {
  let uploadedRef: ReturnType<typeof createStorageRef> | null = null
  let uploadSessionId: string | null = null
  let finalized = false
  let fileBuffer: Buffer | null = null

  let { data: importRow, error: importError } = await supabase
    .from('camera_live_imports')
    .select(
      'id, local_path, file_size_bytes, status, storage_path, storage_provider, storage_bucket, photo_upload_session_id'
    )
    .eq('album_id', session.album_id)
    .eq('filename', file.filename)
    .maybeSingle<CameraImportRow>()

  if (
    importError &&
    /storage_provider|storage_bucket|photo_upload_session_id/i.test(
      importError.message
    )
  ) {
    const legacyResult = await supabase
      .from('camera_live_imports')
      .select('id, local_path, file_size_bytes, status, storage_path')
      .eq('album_id', session.album_id)
      .eq('filename', file.filename)
      .maybeSingle()

    importError = legacyResult.error
    importRow = legacyResult.data
      ? {
          ...legacyResult.data,
          storage_provider: null,
          storage_bucket: null,
          photo_upload_session_id: null,
        }
      : null
  }

  if (importError || !importRow?.local_path) {
    console.error(
      `[camera-live-import-worker] missing local file row filename=${file.filename}:`,
      importError?.message || 'No local_path'
    )
    return
  }

  if (importRow.status === 'done') return

  try {
    const { error: markUploadingError } = await supabase
      .from('camera_live_imports')
      .update({
        status: 'uploading',
        progress: 70,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    if (markUploadingError) {
      throw new Error(
        `Unable to mark camera import as uploading: ${markUploadingError.message}`
      )
    }

    fileBuffer = await fs.readFile(importRow.local_path)
    const fileSizeBytes = fileBuffer.length
    const fileHash = hashCameraPhoto(fileBuffer)
    const useR2 = isR2PhotoUploadEnabledForOwner(session.owner_id)
    const r2Bucket =
      useR2 || importRow.storage_provider === 'r2'
        ? getR2Config().bucketName
        : null

    const safeFileName = getUploadSafeFileName(file.filename)
    const plan = createCameraUploadPlan({
      ownerId: session.owner_id,
      albumId: session.album_id,
      importId: importRow.id,
      useR2,
      r2Bucket,
      existingProvider: importRow.storage_provider,
      existingBucket: importRow.storage_bucket,
      existingKey: importRow.storage_path,
      existingUploadSessionId: importRow.photo_upload_session_id,
      legacySupabaseKey:
        `${session.owner_id}/${session.album_id}/original/${safeFileName}`,
    })

    if (plan.provider === 'r2') {
      const reservation = await reserveCameraR2Upload({
        session,
        importId: importRow.id,
        storageBucket: plan.bucket,
        storagePath: plan.key,
        file,
        fileSizeBytes,
        fileHash,
      })
      uploadSessionId = reservation.session_id
    }

    const ref = createStorageRef({
      provider: plan.provider,
      bucket: plan.bucket,
      key: plan.key,
    })
    const adapter = getStorageAdapter(plan.provider, {
      supabase: plan.provider === 'supabase' ? supabase : undefined,
    })

    await ensureCameraUploadObject({ adapter, ref, body: fileBuffer })
    uploadedRef = ref

    const finalizingState = {
      storage_path: plan.key,
      ...(plan.provider === 'r2'
        ? {
            storage_provider: plan.provider,
            storage_bucket: plan.bucket,
            photo_upload_session_id: uploadSessionId,
          }
        : {}),
      status: 'finalizing',
      progress: 85,
      updated_at: new Date().toISOString(),
    }
    const { error: markFinalizingError } = await supabase
      .from('camera_live_imports')
      .update(finalizingState)
      .eq('id', importRow.id)

    if (markFinalizingError) {
      throw new Error(
        `Unable to save uploaded camera file state: ${markFinalizingError.message}`
      )
    }

    const finalizeResult = await finalizeCameraUpload({
      session,
      file,
      storagePath: plan.key,
      fileSizeBytes,
      fileHash,
      storageProvider: plan.provider,
      storageBucket: plan.bucket,
      cameraImportId: importRow.id,
      uploadSessionId,
    })

    if (
      finalizeResult.duplicate === true &&
      finalizeResult.idempotent !== true
    ) {
      await adapter.deleteObject(ref)
      if (uploadSessionId) {
        await cancelCameraR2Upload(uploadSessionId, importRow.id)
      }
      uploadedRef = null
    }

    finalized = true

    const { error: markDoneError } = await supabase
      .from('camera_live_imports')
      .update({
        status: 'done',
        progress: 100,
        error: null,
        uploaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    if (markDoneError) {
      throw new Error(
        `Unable to complete camera import: ${markDoneError.message}`
      )
    }

    await fs.unlink(importRow.local_path).catch(() => {})
    uploadedRef = null

    console.log(
      `[camera-live-import-worker] DONE album=${session.album_id} file=${file.filename}`
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Upload/finalize failed'

    const canCleanup =
      !finalized &&
      uploadedRef &&
      error instanceof CameraFinalizeError &&
      error.cleanupSafe

    if (canCleanup && uploadedRef) {
      const cleanupRef = uploadedRef

      try {
        const adapter = getStorageAdapter(cleanupRef.provider, {
          supabase: cleanupRef.provider === 'supabase' ? supabase : undefined,
        })
        await adapter.deleteObject(cleanupRef)
        if (uploadSessionId) {
          await cancelCameraR2Upload(uploadSessionId, importRow.id)
        }
        uploadedRef = null
      } catch (cleanupError) {
        console.error(
          `[camera-live-import-worker] cleanup uploaded file failed path=${cleanupRef.key}:`,
          cleanupError instanceof Error ? cleanupError.message : cleanupError
        )
      }
    }

    await supabase
      .from('camera_live_imports')
      .update({
        status: 'failed',
        error: isStorageLimitError(error)
          ? 'Storage full. Please upgrade plan or free up space.'
          : message,
        updated_at: new Date().toISOString(),
      })
      .eq('album_id', session.album_id)
      .eq('filename', file.filename)

    console.error(
      `[camera-live-import-worker] upload/finalize failed album=${session.album_id} filename=${file.filename}:`,
      message
    )
  } finally {
    fileBuffer?.fill(0)
    fileBuffer = null
  }
}

const STUCK_IMPORT_AGE_MS = 60 * 1000

async function resumeStuckImports(session: CameraUploadSession) {
  const staleBefore = new Date(Date.now() - STUCK_IMPORT_AGE_MS).toISOString()

  const { data, error } = await supabase
    .from('camera_live_imports')
    .select('camera_file_id, filename, status')
    .eq('album_id', session.album_id)
    .in('status', ['pending', 'imported', 'uploading', 'finalizing', 'uploaded'])
    .lt('updated_at', staleBefore)

  if (error) {
    console.error(
      '[camera-live-import-worker] resume stuck imports lookup failed:',
      error.message
    )
    return
  }

  const stuckRows = data || []

  if (stuckRows.length === 0) return

  console.log(
    `[camera-live-import-worker] resuming ${stuckRows.length} stuck import(s) album=${session.album_id}`
  )

  // camera_file_id on a stuck row may be stale (it's just gphoto2's
  // current listing position, which shifts across reconnects), so
  // re-resolve it from a fresh listing before retrying a download.
  const needsFreshListing = stuckRows.some((row) => row.status === 'pending')
  const currentFilesByName = needsFreshListing
    ? new Map((await listCameraJpgFiles()).map((f) => [f.filename, f]))
    : new Map<string, CameraFile>()

  for (const row of stuckRows) {
    if (row.status === 'pending') {
      const current = currentFilesByName.get(row.filename)

      if (!current) {
        console.warn(
          `[camera-live-import-worker] stuck file no longer on camera, skipping filename=${row.filename}`
        )
        continue
      }

      await downloadCameraFile(session, current)
      await uploadLocalCameraFile(session, current)
      continue
    }

    await uploadLocalCameraFile(session, {
      cameraFileId: row.camera_file_id || '',
      filename: row.filename,
    })
  }
}

const MAX_CAMERA_IMPORT_RETRIES = 3

// getUntrackedFiles treats any tracked filename as "already seen"
// regardless of status, so a file that reached status='failed' (e.g.
// a network blip during finalize-upload) would otherwise never be
// reconsidered. The downloaded local file is preserved on failure
// (uploadLocalCameraFile only unlinks it after a full success), so a
// retry can go straight to uploadLocalCameraFile the same way a stuck
// 'imported' row does. Storage-limit failures are excluded since
// retrying won't help until the user frees space or upgrades.
async function retryFailedImports(session: CameraUploadSession) {
  const { data, error } = await supabase
    .from('camera_live_imports')
    .select('camera_file_id, filename, retry_count, error')
    .eq('album_id', session.album_id)
    .eq('status', 'failed')
    .lt('retry_count', MAX_CAMERA_IMPORT_RETRIES)

  if (error) {
    console.error(
      '[camera-live-import-worker] retry failed imports lookup failed:',
      error.message
    )
    return
  }

  const retryableRows = (data || []).filter(
    (row) => !isStorageLimitError(new Error(String(row.error || '')))
  )

  if (retryableRows.length === 0) return

  console.log(
    `[camera-live-import-worker] retrying ${retryableRows.length} previously-failed import(s) album=${session.album_id}`
  )

  for (const row of retryableRows) {
    const { error: incrementError } = await supabase
      .from('camera_live_imports')
      .update({
        retry_count: (row.retry_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('album_id', session.album_id)
      .eq('filename', row.filename)

    if (incrementError) {
      console.error(
        `[camera-live-import-worker] retry_count increment failed filename=${row.filename}:`,
        incrementError.message
      )
      continue
    }

    await uploadLocalCameraFile(session, {
      cameraFileId: row.camera_file_id || '',
      filename: row.filename,
    })
  }
}

async function processSession(session: CameraUploadSession) {
  const camera = await getCachedCamera()

  if (!camera) {
    console.log(
      `[camera-live-import-worker] no camera detected for album=${session.album_id}`
    )
    return
  }

  console.log(
    `[camera-live-import-worker] camera connected model="${camera.model}" port="${camera.port}" album=${session.album_id}`
  )

  await resumeStuckImports(session)
  await retryFailedImports(session)

    const files = await listCameraJpgFiles()

  const supportedFiles = files.filter((file) =>
    isSupportedCameraFile(file.filename)
  )

  if (supportedFiles.length === 0) {
    console.log(
      `[camera-live-import-worker] no supported JPG files found album=${session.album_id}`
    )
    return
  }

  console.log(
    `[camera-live-import-worker] found ${supportedFiles.length} supported JPG file(s): ${supportedFiles
      .slice(0, 5)
      .map((file) => file.filename)
      .join(', ')}`
  )

  const baselineNewFiles = await getBaselineFilteredFiles(
  session,
  supportedFiles
)

const newFiles = await filterNewCameraFiles(session, baselineNewFiles)

  if (newFiles.length === 0) {
    console.log(
      `[camera-live-import-worker] no new JPG files album=${session.album_id}`
    )
    return
  }

  await supabase
    .from('camera_upload_sessions')
    .update({
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  console.log(
    `[camera-live-import-worker] album=${session.album_id} queueing ${newFiles.length} new JPG file(s)`
  )

  for (const file of newFiles) {
  await queueCameraFile(session, file)
  await downloadCameraFile(session, file)
  await uploadLocalCameraFile(session, file)

  

  const baseline = sessionBaselines.get(session.id)

  if (baseline) {
   baseline.add(file.filename)
  }
}
}



async function main() {
  console.log('[camera-live-import-worker] started')

  while (true) {
  try {
    await sendHeartbeat()
    await expireInactiveSessions()

      const sessions = await loadActiveSessions()

      if (sessions.length === 0) {
        console.log('[camera-live-import-worker] no active sessions')
      }

      for (const session of sessions) {
        await processSession(session)
      }
    } catch (error) {
      console.error('[camera-live-import-worker] loop error:', error)
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

main().catch((error) => {
  console.error('[camera-live-import-worker] fatal:', error)
  process.exit(1)
})
