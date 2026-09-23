import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'
import crypto from 'crypto'
import {
  resolvePhotoUploadPrincipal,
  type PhotoUploadPrincipal,
} from '@/lib/photo-upload-principal'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import {
  assertOwnedAlbumObjectKey,
  createStorageRef,
  getStorageAdapter,
  resolvePresetStorageRef,
  resolvePhotoDelivery,
  type StorageProvider,
} from '@/lib/storage'
import { MAX_DIRECT_PHOTO_UPLOAD_BYTES } from '@/lib/storage/photo-upload-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type RequestedSize = 'sd' | 'hd' | 'uhd' | 'original'
type CiiyaSyncUploadSource =
  | 'ciiya-sync'
  | 'ciiya-sync-live-folder'
  | 'ciiya-sync-export-selection'

type PhotoRecord = {
  id: string
  album_id: string
  owner_id?: string | null
  user_id?: string | null

  filename?: string | null
  file_name?: string | null

  original_path?: string | null
  storage_path?: string | null

  preset_path?: string | null

  public_url?: string | null
  original_url?: string | null
  preview_url?: string | null
  thumbnail_url?: string | null
  preview_path?: string | null
  thumbnail_path?: string | null

  processing_status?: string | null
  storage_provider?: StorageProvider | null
  storage_bucket?: string | null
}

type UploadFinalizationSession = {
  session_id: string
  session_owner_id: string
  session_album_id: string
  session_category_id: string | null
  completed_photo_id: string | null
  session_storage_provider: 'r2'
  session_storage_bucket: string
  session_object_key: string
  session_original_file_name: string
  session_content_type: string
  session_expected_size_bytes: number | string
  session_file_hash: string
  session_requested_size: RequestedSize
  session_preset_path: string | null
  session_auto_face_scan: boolean
  session_auto_publish: boolean
  session_status: string
  session_expires_at: string
  already_completed: boolean
}

type SupabaseAdminClient = SupabaseClient

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) || null
  if (value && typeof value === 'object') return value as T
  return null
}

function finalizationRpcCode(message: string) {
  return message.match(
    /(?:SYNC_DEVICE_UNAUTHORIZED|UPLOAD_SESSION_[A-Z_]+|PHOTO_UPLOAD_BINDING_MISMATCH|CAMERA_[A-Z_]+|CAMERA_UPLOAD_BINDING_MISMATCH)/
  )?.[0]
}

function isValidWorkerSecret(providedSecret: string) {
  const configuredSecret = String(
    process.env.WORKER_SECRET || ''
  ).trim()

  const normalizedProvidedSecret = providedSecret.trim()

  if (!configuredSecret || !normalizedProvidedSecret) {
    return false
  }

  const configuredBuffer = Buffer.from(configuredSecret)
  const providedBuffer = Buffer.from(normalizedProvidedSecret)

  if (configuredBuffer.length !== providedBuffer.length) {
    return false
  }

  const result = crypto.timingSafeEqual(
  configuredBuffer,
  providedBuffer
)

configuredBuffer.fill(0)
providedBuffer.fill(0)

return result
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) return null

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function normalizeRequestedSize(value: string): RequestedSize {
  if (value === 'sd') return 'sd'
  if (value === 'uhd') return 'uhd'
  if (value === 'original') return 'original'
  return 'hd'
}

function normalizeCiiyaSyncUploadSource(value: unknown): CiiyaSyncUploadSource {
  if (value === 'ciiya-sync-live-folder') {
    return 'ciiya-sync-live-folder'
  }
  if (value === 'ciiya-sync-export-selection') {
    return 'ciiya-sync-export-selection'
  }
  return 'ciiya-sync'
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

async function storageObjectExists(
  supabaseAdmin: SupabaseAdminClient,
  storagePath: string,
  bucket = 'albums'
) {
  const pathParts = storagePath.split('/')
  const fileName = pathParts.pop()

  if (!fileName || pathParts.length === 0) {
    return false
  }

  const folderPath = pathParts.join('/')

  const { data, error } =
  await supabaseAdmin.storage
    .from(bucket)
    .list(folderPath, {
      limit: 100,
      search: fileName,
    })

  if (error) {
    throw new Error(
      `Storage lookup failed: ${error.message}`
    )
  }

  return data.some((item) => item.name === fileName)
}

async function presetStorageObjectExists(params: {
  supabaseAdmin: SupabaseAdminClient
  ownerId: string
  albumId: string
  presetPath: string
}) {
  const ref = await resolvePresetStorageRef({
    supabase: params.supabaseAdmin,
    ownerId: params.ownerId,
    albumId: params.albumId,
    presetPath: params.presetPath,
  })

  if (!ref) return false

  const result = await getStorageAdapter(ref.provider).objectExists(ref)
  return result.exists
}

function getPhotoJobPriority(params: {
  fileSizeBytes: number
  size: RequestedSize
  hasPreset: boolean
}) {
  const sizeMb = params.fileSizeBytes / 1024 / 1024
  let priority = 100

  if (params.size === 'sd') priority -= 15
  if (params.size === 'hd') priority -= 10
  if (params.size === 'uhd') priority += 10
  if (params.size === 'original') priority += 20

  if (sizeMb <= 5) priority -= 10
  if (sizeMb > 15) priority += 10
  if (sizeMb > 35) priority += 20
  if (sizeMb > 70) priority += 35
  if (params.hasPreset) priority += 5

  return Math.max(10, Math.min(200, Math.round(priority)))
}

async function ensurePhotoJob(params: {
  supabaseAdmin: SupabaseAdminClient
  photo: PhotoRecord
  fallbackOriginalPath?: string | null
  presetPath?: string | null
  size: RequestedSize
  jobPriority: number
  fileHash?: string | null
  fileName?: string | null
  publicUrl?: string | null
  source: string
  storageProvider?: StorageProvider
  storageBucket?: string | null
}) {
  const {
    supabaseAdmin,
    photo,
    fallbackOriginalPath,
    presetPath,
    size,
    jobPriority,
    fileHash,
    fileName,
    publicUrl,
    source,
    storageProvider = 'supabase',
    storageBucket = null,
  } = params

  const photoId = photo.id
  const albumId = photo.album_id
  const ownerId =
    photo.owner_id ||
    photo.user_id ||
    null

  const originalPath =
    photo.original_path ||
    photo.storage_path ||
    fallbackOriginalPath ||
    null

  if (
    !photoId ||
    !albumId ||
    !ownerId ||
    !originalPath
  ) {
    return {
      queued: false,
      jobId: null,
      error:
        'Missing photo_id, album_id, owner_id, or original_path',
    }
  }

  const activeJobResult =
    await supabaseAdmin
      .from('photo_jobs')
      .select('id,status')
      .eq('photo_id', photoId)
      .in('status', [
        'pending',
        'processing',
      ])
      .order('created_at', {
        ascending: false,
      })
      .limit(1)

  if (activeJobResult.error) {
    console.error(
      '[finalize-upload] active photo job lookup failed:',
      activeJobResult.error.message
    )

    return {
      queued: false,
      jobId: null,
      error:
        'Unable to check existing photo job',
    }
  }

  const activeJob =
    activeJobResult.data?.[0] || null

  if (activeJob?.id) {
    return {
      queued: true,
      jobId: activeJob.id,
      error: null,
    }
  }

  const resolvedPresetPath =
    photo.preset_path ||
    presetPath ||
    null

  const insertJobResult =
    await supabaseAdmin
      .from('photo_jobs')
      .insert({
        photo_id: photoId,
        album_id: albumId,
        owner_id: ownerId,
        original_path: originalPath,
        preset_path: resolvedPresetPath,
        size,
        status: 'pending',
        priority: jobPriority,
        progress: 0,
        retry_count: 0,
        retries: 0,
        started_at: null,
        finished_at: null,
        error: null,
        worker_id: null,
        claimed_by: null,
        payload: {
          source,
          fileHash,
          originalName:
            fileName ||
            photo.filename ||
            photo.file_name ||
            null,
          publicUrl,
          requestedSize: size,
          presetPath:
            resolvedPresetPath,
          jobPriority,
          storageProvider,
          storageBucket,
        },
        updated_at:
          new Date().toISOString(),
      })
      .select('id,status')
      .single()

  if (
    insertJobResult.error ||
    !insertJobResult.data?.id
  ) {
    /*
     * another Request may create Job succeeded
     * after Request this checks Active Job already
     * so it re-checks before treating it as Enqueue failed
     */
    const concurrentJobResult =
      await supabaseAdmin
        .from('photo_jobs')
        .select('id,status')
        .eq('photo_id', photoId)
        .in('status', [
          'pending',
          'processing',
        ])
        .order('created_at', {
          ascending: false,
        })
        .limit(1)

    const concurrentJob =
      concurrentJobResult.data?.[0] ||
      null

    if (
      !concurrentJobResult.error &&
      concurrentJob?.id
    ) {
      return {
        queued: true,
        jobId: concurrentJob.id,
        error: null,
      }
    }

    console.error(
      '[finalize-upload] create photo job failed:',
      insertJobResult.error?.message ||
        concurrentJobResult.error?.message ||
        'No job returned'
    )

    return {
      queued: false,
      jobId: null,
      error:
        'Unable to create photo job',
    }
  }

  return {
    queued: true,
    jobId: insertJobResult.data.id,
    error: null,
  }
}

async function safeRecalculateStorage(
  supabaseAdmin: SupabaseAdminClient,
  userId: string
) {
  try {
    const { error } = await supabaseAdmin.rpc(
      'recalculate_user_storage',
      {
        user_uuid: userId,
      }
    )

    if (error) {
      console.warn(
        '[finalize-upload] recalculate storage skipped:',
        error.message
      )
    }
  } catch (error) {
    console.warn(
      '[finalize-upload] recalculate storage skipped:',
      error
    )
  }
}

async function completeR2UploadFinalization(params: {
  client: SupabaseClient
  uploadSessionId: string
  photoId: string
  principalKind: 'browser' | 'ciiya-sync' | 'worker'
  deviceId: string | null
  cameraImportId: string | null
}) {
  if (params.principalKind === 'worker' && params.cameraImportId) {
    return params.client.rpc('complete_camera_photo_upload_finalization', {
      p_session_id: params.uploadSessionId,
      p_camera_import_id: params.cameraImportId,
      p_photo_id: params.photoId,
    })
  }

  if (params.principalKind === 'ciiya-sync' && params.deviceId) {
    return params.client.rpc('complete_ciiya_sync_photo_upload_finalization', {
      p_device_id: params.deviceId,
      p_session_id: params.uploadSessionId,
      p_photo_id: params.photoId,
    })
  }

  return params.client.rpc('complete_photo_upload_finalization', {
    p_session_id: params.uploadSessionId,
    p_photo_id: params.photoId,
  })
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const workerSecret = String(
  req.headers.get('x-worker-secret') || ''
).trim()

const isWorkerRequest =
  isValidWorkerSecret(workerSecret)

  if (workerSecret && !isWorkerRequest) {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401 }
  )
}

    let uploadPrincipal: PhotoUploadPrincipal | null = null

    if (!isWorkerRequest) {
      const resolved = await resolvePhotoUploadPrincipal({
        request: req,
        browserClient: supabase,
      })
      uploadPrincipal = resolved.principal

      if (resolved.rolloutDisabled) {
        return NextResponse.json(
          {
            error: 'Ciiya Sync is temporarily paused',
            code: 'CIIYA_SYNC_ROLLOUT_PAUSED',
          },
          {
            status: 503,
            headers: {
              'Cache-Control': 'no-store, max-age=0',
              'Retry-After': '60',
            },
          }
        )
      }

      if (!uploadPrincipal) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (uploadPrincipal.kind === 'ciiya-sync') {
        const rate = await rateLimit(req, {
          bucket: 'ciiya-sync-photo-finalize',
          identifier: uploadPrincipal.deviceId,
          limit: 600,
          windowSeconds: 10 * 60,
        })

        if (!rate.allowed) {
          return tooManyRequests(rate, 'Ciiya Sync is finalizing too quickly')
        }
      }
    }

    const body = await req.json().catch(() => null)

if (!body) {
  return NextResponse.json(
    { error: 'Invalid request body' },
    { status: 400 }
  )
}

    let albumId = String(body.albumId || '').trim()
    let storagePath = String(body.storagePath || '').trim()
    let fileName = String(body.fileName || '').trim()
    let fileSizeBytes = Number(body.fileSizeBytes || 0)
    const storageProvider = String(
      body.storageProvider || 'supabase'
    ).trim() as StorageProvider
    let storageBucket = body.storageBucket
      ? String(body.storageBucket).trim()
      : storageProvider === 'supabase'
        ? 'albums'
        : ''
    const uploadSessionId = body.uploadSessionId
      ? String(body.uploadSessionId).trim()
      : null
    const cameraImportId = body.cameraImportId
      ? String(body.cameraImportId).trim()
      : null
    const syncUploadSource =
      uploadPrincipal?.kind === 'ciiya-sync'
        ? normalizeCiiyaSyncUploadSource(body.uploadSource)
        : null
    const finalizationPrincipalKind = isWorkerRequest
      ? 'worker'
      : uploadPrincipal!.kind
    const finalizationDeviceId =
      uploadPrincipal?.kind === 'ciiya-sync'
        ? uploadPrincipal.deviceId
        : null

if (storageProvider !== 'supabase' && storageProvider !== 'r2') {
  return NextResponse.json(
    { error: 'Invalid storage provider' },
    { status: 400 }
  )
}

if (uploadPrincipal?.kind === 'ciiya-sync' && storageProvider !== 'r2') {
  return NextResponse.json(
    { error: 'Ciiya Sync uploads require R2 storage' },
    { status: 400 }
  )
}

if (
  storageProvider === 'r2' &&
  isWorkerRequest &&
  (!cameraImportId || !UUID_PATTERN.test(cameraImportId))
) {
  return NextResponse.json(
    { error: 'Missing camera import binding' },
    { status: 400 }
  )
}

if (cameraImportId && !isWorkerRequest) {
  return NextResponse.json(
    { error: 'Camera import binding is worker-only' },
    { status: 400 }
  )
}

const providedFileHash = String(
  body.fileHash || ''
).trim()

if (providedFileHash.length > 500) {
  return NextResponse.json(
    { error: 'Invalid file hash' },
    { status: 400 }
  )
}

const hashSource =
  providedFileHash ||
  `${fileName}-${fileSizeBytes}-${storagePath}`

let fileHash = /^[a-f0-9]{64}$/i.test(
  hashSource
)
  ? hashSource.toLowerCase()
  : crypto
      .createHash('sha256')
      .update(hashSource, 'utf8')
      .digest('hex')

    let size = normalizeRequestedSize(String(body.size || 'hd').toLowerCase())
    let categoryId = body.categoryId
  ? String(body.categoryId).trim().slice(0, 100)
  : null
    let presetPath = body.presetPath ? String(body.presetPath).trim() : null

 if (
  !albumId ||
  !storagePath ||
  !fileName ||
  !Number.isSafeInteger(fileSizeBytes) ||
  fileSizeBytes <= 0
) {
      return NextResponse.json(
        { error: 'Missing required upload data' },
        { status: 400 }
      )
    }

    if (fileSizeBytes > MAX_DIRECT_PHOTO_UPLOAD_BYTES) {
  return NextResponse.json(
    { error: 'File too large' },
    { status: 400 }
  )
}

    if (
  albumId.length > 100 ||
  storagePath.length > 500 ||
  fileName.length > 255 ||
  fileHash.length > 255 ||
  (presetPath && presetPath.length > 500)
) {
  return NextResponse.json(
    { error: 'Invalid upload data' },
    { status: 400 }
  )
}

     const supabaseAdmin = getSupabaseAdmin()

    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Missing SUPABASE_SERVICE_ROLE_KEY' },
        { status: 500 }
      )
    }

    const { data: album, error: albumError } = await supabaseAdmin
  .from('albums')
  .select('id, owner_id, user_id, cover_url')
  .eq('id', albumId)
  .single()

    if (albumError || !album) {
  return NextResponse.json({ error: 'Album not found' }, { status: 404 })
}

if (!isWorkerRequest && uploadPrincipal) {
  const canAccess =
    album.owner_id === uploadPrincipal.ownerId ||
    album.user_id === uploadPrincipal.ownerId

  if (!canAccess) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  }
}
    
const ownerId =
  album.owner_id || album.user_id || uploadPrincipal?.ownerId || null

if (!ownerId) {
  return NextResponse.json(
    { error: 'Missing album owner' },
    { status: 500 }
  )
}

let r2Session: UploadFinalizationSession | null = null

if (storageProvider === 'r2') {
  if (!uploadSessionId || !UUID_PATTERN.test(uploadSessionId) || !storageBucket) {
    return NextResponse.json(
      { error: 'Missing R2 upload session data' },
      { status: 400 }
    )
  }

  const finalizationClient = isWorkerRequest
    ? supabaseAdmin
    : uploadPrincipal!.client
  const beginRpc = isWorkerRequest
    ? 'begin_camera_photo_upload_finalization'
    : uploadPrincipal?.kind === 'ciiya-sync'
      ? 'begin_ciiya_sync_photo_upload_finalization'
      : 'begin_photo_upload_finalization'
  const beginParams = isWorkerRequest
    ? {
        p_session_id: uploadSessionId,
        p_camera_import_id: cameraImportId!,
      }
    : uploadPrincipal?.kind === 'ciiya-sync'
      ? {
          p_device_id: uploadPrincipal.deviceId,
          p_session_id: uploadSessionId,
        }
      : { p_session_id: uploadSessionId }
  const { data: sessionData, error: sessionError } =
    await finalizationClient.rpc(beginRpc, beginParams)

  if (sessionError) {
    const code = finalizationRpcCode(sessionError.message)
    const status =
      code === 'SYNC_DEVICE_UNAUTHORIZED'
        ? 401
        : code === 'UPLOAD_SESSION_NOT_FOUND'
        ? 404
        : code === 'UPLOAD_SESSION_EXPIRED'
          ? 410
          : 409

    return NextResponse.json(
      {
        error: code || 'Unable to begin upload finalization',
        code: code || 'UPLOAD_FINALIZATION_FAILED',
      },
      { status }
    )
  }

  r2Session = firstRow<UploadFinalizationSession>(sessionData)

  if (
    !r2Session ||
    r2Session.session_owner_id !== ownerId ||
    r2Session.session_album_id !== albumId ||
    r2Session.session_storage_provider !== 'r2' ||
    r2Session.session_storage_bucket !== storageBucket ||
    r2Session.session_object_key !== storagePath
  ) {
    return NextResponse.json(
      { error: 'Upload session does not match this object' },
      { status: 409 }
    )
  }

  if (r2Session.already_completed && r2Session.completed_photo_id) {
    const { data: completedPhoto, error: completedPhotoError } =
      await supabaseAdmin
        .from('photos')
        .select(
          'id, storage_provider, storage_bucket, public_url, preview_url, thumbnail_url, preview_path, thumbnail_path, processing_status'
        )
        .eq('id', r2Session.completed_photo_id)
        .eq('owner_id', ownerId)
        .maybeSingle()

    if (completedPhotoError || !completedPhoto) {
      return NextResponse.json(
        { error: 'Completed upload photo was not found' },
        { status: 409 }
      )
    }

    const deliveryPhoto = resolvePhotoDelivery(completedPhoto)

    return NextResponse.json({
      success: true,
      duplicate: false,
      idempotent: true,
      photoId: completedPhoto.id,
      publicUrl: deliveryPhoto.preview_url || deliveryPhoto.public_url,
      thumbnailUrl: deliveryPhoto.thumbnail_url,
      processingStatus: completedPhoto.processing_status || 'pending',
    })
  }

  albumId = r2Session.session_album_id
  storagePath = r2Session.session_object_key
  storageBucket = r2Session.session_storage_bucket
  fileName = r2Session.session_original_file_name
  fileSizeBytes = Number(r2Session.session_expected_size_bytes)
  fileHash = r2Session.session_file_hash
  size = normalizeRequestedSize(r2Session.session_requested_size)
  categoryId = r2Session.session_category_id
  presetPath = r2Session.session_preset_path
}

const expectedOriginalPrefix =
  `${ownerId}/${albumId}/original/`

const expectedAlbumPresetPrefix =
  `${ownerId}/${albumId}/presets/`

const expectedUserPresetPrefix =
  `${ownerId}/presets/`

if (!storagePath.startsWith(expectedOriginalPrefix)) {
  return NextResponse.json(
    { error: 'Invalid storage path' },
    { status: 400 }
  )
}

if (
  presetPath &&
  !presetPath.startsWith(
    expectedAlbumPresetPrefix
  ) &&
  !presetPath.startsWith(
    expectedUserPresetPrefix
  )
) {
  return NextResponse.json(
    { error: 'Invalid preset path' },
    { status: 400 }
  )
}

if (hasUnsafeStoragePath(storagePath)) {
  return NextResponse.json(
    { error: 'Invalid storage path' },
    { status: 400 }
  )
}

if (presetPath && hasUnsafeStoragePath(presetPath)) {
  return NextResponse.json(
    { error: 'Invalid preset path' },
    { status: 400 }
  )
}

let r2OriginalRef: ReturnType<typeof createStorageRef> | null = null

if (storageProvider === 'r2') {
  try {
    assertOwnedAlbumObjectKey(storagePath, ownerId, albumId, ['original'])
    r2OriginalRef = createStorageRef({
      provider: 'r2',
      bucket: storageBucket,
      key: storagePath,
    })
  } catch {
    return NextResponse.json(
      { error: 'Invalid R2 storage object' },
      { status: 400 }
    )
  }
}

const [
  originalObjectResult,
  presetFileExists,
  existingPhotoResult,
] = await Promise.all([
  r2OriginalRef
    ? getStorageAdapter('r2').objectExists(r2OriginalRef)
    : storageObjectExists(supabaseAdmin, storagePath),
  presetPath
    ? presetStorageObjectExists({
        supabaseAdmin,
        ownerId,
        albumId,
        presetPath,
      })
    : Promise.resolve(true),
  supabaseAdmin
    .from('photos')
    .select(
      `
      id,
      album_id,
      owner_id,
      user_id,
      filename,
      file_name,
      file_hash,
      public_url,
      original_url,
      preview_url,
      thumbnail_url,
      preview_path,
      thumbnail_path,
      processing_status,
      original_path,
      storage_path,
      preset_path,
      storage_provider,
      storage_bucket,
      original_size_bytes
    `
    )
    .eq('album_id', albumId)
    .eq('file_hash', fileHash)
    .maybeSingle(),
])

const originalFileExists =
  typeof originalObjectResult === 'boolean'
    ? originalObjectResult
    : originalObjectResult.exists

if (!originalFileExists) {
  return NextResponse.json(
    {
      error: 'Uploaded file not found in storage',
      cleanupSafe: storageProvider === 'r2',
    },
    { status: 400 }
  )
}

if (r2OriginalRef && typeof originalObjectResult !== 'boolean') {
  const storedContentType = String(originalObjectResult.contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  const expectedContentType = String(r2Session?.session_content_type || '')
    .trim()
    .toLowerCase()

  if (originalObjectResult.sizeBytes !== fileSizeBytes) {
    return NextResponse.json(
      {
        error: 'Uploaded object size does not match the reservation',
        code: 'UPLOAD_SIZE_MISMATCH',
        cleanupSafe: true,
      },
      { status: 400 }
    )
  }

  if (!storedContentType || storedContentType !== expectedContentType) {
    return NextResponse.json(
      {
        error: 'Uploaded object type does not match the reservation',
        code: 'UPLOAD_CONTENT_TYPE_MISMATCH',
        cleanupSafe: true,
      },
      { status: 400 }
    )
  }
}

if (presetPath && !presetFileExists) {
  return NextResponse.json(
    {
      error:
        'Preset file not found in storage',
      cleanupSafe: storageProvider === 'r2',
    },
    { status: 400 }
  )
}

    const { data: existingPhoto, error: existingPhotoError } =
      existingPhotoResult

    if (existingPhotoError) {
      return NextResponse.json(
        { error: existingPhotoError.message },
        { status: 500 }
      )
    }

    const jobPriority = getPhotoJobPriority({
      fileSizeBytes,
      size,
      hasPreset: Boolean(presetPath),
    })

    const publicUrl = r2OriginalRef
      ? getStorageAdapter('r2').getPublicUrl(r2OriginalRef)
      : supabaseAdmin.storage.from('albums').getPublicUrl(storagePath).data
          .publicUrl

    if (existingPhoto) {
      const isSameR2Upload =
        storageProvider === 'r2' &&
        existingPhoto.storage_provider === 'r2' &&
        existingPhoto.storage_bucket === storageBucket &&
        existingPhoto.storage_path === storagePath &&
        existingPhoto.original_path === storagePath &&
        Number(existingPhoto.original_size_bytes) === fileSizeBytes

      if (isSameR2Upload && uploadSessionId) {
        const { error: completeExistingError } =
          await completeR2UploadFinalization({
            client: isWorkerRequest ? supabaseAdmin : uploadPrincipal!.client,
            uploadSessionId,
            photoId: existingPhoto.id,
            principalKind: finalizationPrincipalKind,
            deviceId: finalizationDeviceId,
            cameraImportId: isWorkerRequest ? cameraImportId : null,
          })

        if (completeExistingError) {
          return NextResponse.json(
            {
              error: 'Unable to complete upload session',
              code:
                finalizationRpcCode(completeExistingError.message) ||
                'UPLOAD_SESSION_COMPLETE_FAILED',
            },
            { status: 409 }
          )
        }
      }

      const needsRepair =
        !existingPhoto.preview_url ||
        !existingPhoto.thumbnail_url ||
        ['pending', 'processing', 'failed'].includes(
          String(existingPhoto.processing_status || '')
        )

      let queueResult: Awaited<ReturnType<typeof ensurePhotoJob>> | null = null

      if (needsRepair) {
        queueResult = await ensurePhotoJob({
          supabaseAdmin,
          photo: existingPhoto,
          fallbackOriginalPath: storagePath,
          presetPath,
          size,
          jobPriority,
          fileHash,
          fileName,
          publicUrl:
            existingPhoto.preview_url ||
            existingPhoto.public_url ||
            existingPhoto.original_url ||
            publicUrl,
          source: syncUploadSource
            ? `${syncUploadSource}-duplicate-repair`
            : 'finalize-upload-duplicate-repair',
          storageProvider:
            existingPhoto.storage_provider === 'r2' ? 'r2' : 'supabase',
          storageBucket: existingPhoto.storage_bucket || null,
        })

        const { error: duplicateRepairUpdateError } =
  await supabaseAdmin
    .from('photos')
    .update({
      processing_status: queueResult.queued
        ? 'pending'
        : 'failed',
      processing_progress: 0,
      preset_path:
        existingPhoto.preset_path ||
        presetPath ||
        null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingPhoto.id)

if (duplicateRepairUpdateError) {
  console.error(
    '[finalize-upload] duplicate repair status update failed:',
    duplicateRepairUpdateError.message
  )
}
      }

      const deliveryPhoto = resolvePhotoDelivery(existingPhoto)

      return NextResponse.json({
        success: true,
        duplicate: !isSameR2Upload,
        idempotent: isSameR2Upload,
        repaired: needsRepair,
        jobQueued: queueResult?.queued || false,
        jobId: queueResult?.jobId || null,
        jobError: queueResult?.error || null,
        photoId: existingPhoto.id,
        publicUrl:
          deliveryPhoto.preview_url ||
          deliveryPhoto.public_url ||
          deliveryPhoto.original_url ||
          publicUrl,
        thumbnailUrl: deliveryPhoto.thumbnail_url,
        processingStatus: needsRepair
          ? queueResult?.queued
            ? 'pending'
            : 'failed'
          : existingPhoto.processing_status || 'done',
        jobPriority,
      })
    }

    await safeRecalculateStorage(supabaseAdmin, ownerId)

const storagePlan = await getUserStoragePlan(ownerId)

const currentUsed = Number(storagePlan.usedBytes)
const currentLimit = Number(storagePlan.storageLimitBytes)
const normalizedPlan = storagePlan.plan

if (
  !Number.isSafeInteger(currentUsed) ||
  currentUsed < 0 ||
  !Number.isSafeInteger(currentLimit) ||
  currentLimit < 0
) {
  throw new Error('Invalid storage quota data')
}

const estimatedUploadBytes =
  fileSizeBytes +
  Math.round(fileSizeBytes * 0.35) +
  Math.round(fileSizeBytes * 0.05)

const estimatedNextUsage =
  currentUsed + estimatedUploadBytes

if (
  !Number.isSafeInteger(estimatedUploadBytes) ||
  !Number.isSafeInteger(estimatedNextUsage)
) {
  throw new Error(
    'Storage calculation exceeds safe integer range'
  )
}

if (estimatedNextUsage > currentLimit) {

  return NextResponse.json(
  {
    error: 'Storage full',
    code: 'STORAGE_LIMIT_EXCEEDED',
    cleanupSafe: storageProvider === 'r2',
    plan: normalizedPlan,
    storageUsedBytes: currentUsed,
    storageLimitBytes: currentLimit,
    estimatedUploadBytes,
    remainingBytes: Math.max(0, currentLimit - currentUsed),
  },
  { status: 403 }
)
}

    const { data: insertedPhoto, error: insertError } = await supabaseAdmin
      .from('photos')
      .insert({
        album_id: albumId,
        owner_id: ownerId,
        user_id: ownerId,

        filename: fileName,
        file_name: fileName,
        file_hash: fileHash,

        storage_path: storagePath,
        original_path: storagePath,

        ...(storageProvider === 'r2'
          ? {
              storage_provider: 'r2',
              storage_bucket: storageBucket,
              storage_version: 1,
              migration_status: 'completed',
            }
          : {}),

        public_url: publicUrl,
        original_url: publicUrl,
        image_url: publicUrl,

        category_id: categoryId,
        preset_path: presetPath,
        selected_size: size,

        file_size_bytes: fileSizeBytes,
        original_size_bytes: fileSizeBytes,
        preview_size_bytes: 0,
        thumbnail_size_bytes: 0,

        preview_url: null,
        thumbnail_url: null,
        blur_data_url: null,

        processing_status: 'pending',
        processing_progress: 0,

        metadata: {
          uploadedVia: syncUploadSource || 'api/photos/finalize-upload',
          requestedSize: size,
          presetPath,
          jobPriority,
          storageProvider,
          storageBucket: storageProvider === 'r2' ? storageBucket : null,
          uploadSessionId,
          cameraImportId: isWorkerRequest ? cameraImportId : null,
          ...(finalizationDeviceId
            ? { ciiyaSyncDeviceId: finalizationDeviceId }
            : {}),
        },

        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (insertError || !insertedPhoto) {
      return NextResponse.json(
        { error: insertError?.message || 'Photo insert failed' },
        { status: 500 }
      )
    }

    if (storageProvider === 'r2' && uploadSessionId) {
      const { error: completeSessionError } =
        await completeR2UploadFinalization({
          client: isWorkerRequest ? supabaseAdmin : uploadPrincipal!.client,
          uploadSessionId,
          photoId: insertedPhoto.id,
          principalKind: finalizationPrincipalKind,
          deviceId: finalizationDeviceId,
          cameraImportId: isWorkerRequest ? cameraImportId : null,
        })

      if (completeSessionError) {
        return NextResponse.json(
          {
            error: 'Photo saved but upload session could not be completed',
            code:
              finalizationRpcCode(completeSessionError.message) ||
              'UPLOAD_SESSION_COMPLETE_FAILED',
          },
          { status: 500 }
        )
      }
    }

    const queueResult = await ensurePhotoJob({
      supabaseAdmin,
      photo: insertedPhoto,
      fallbackOriginalPath: storagePath,
      presetPath,
      size,
      jobPriority,
      fileHash,
      fileName,
      publicUrl,
      source: syncUploadSource || 'finalize-upload',
      storageProvider,
      storageBucket: storageProvider === 'r2' ? storageBucket : null,
    })

    if (!queueResult.queued) {
  const { error: queueFailureUpdateError } =
    await supabaseAdmin
      .from('photos')
      .update({
        processing_status: 'failed',
        processing_progress: 0,
        updated_at: new Date().toISOString(),
        metadata: {
          uploadedVia: syncUploadSource || 'api/photos/finalize-upload',
          requestedSize: size,
          presetPath,
          jobPriority,
          queueError: queueResult.error,
          storageProvider,
          storageBucket: storageProvider === 'r2' ? storageBucket : null,
          uploadSessionId,
          cameraImportId: isWorkerRequest ? cameraImportId : null,
          ...(finalizationDeviceId
            ? { ciiyaSyncDeviceId: finalizationDeviceId }
            : {}),
        },
      })
      .eq('id', insertedPhoto.id)

  if (queueFailureUpdateError) {
    console.error(
      '[finalize-upload] queue failure status update failed:',
      queueFailureUpdateError.message
    )
  }

      return NextResponse.json({
        success: true,
        duplicate: false,
        photoId: insertedPhoto.id,
        publicUrl,
        jobQueued: false,
        jobId: null,
        jobError: queueResult.error,
        processingStatus: 'failed',
        jobPriority,
      })
    }

   if (!album.cover_url && insertedPhoto.public_url) {
  const { error: autoCoverError } =
    await supabaseAdmin
      .from('albums')
      .update({
        cover_url: insertedPhoto.public_url,
        cover_photo_id: insertedPhoto.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', albumId)

  if (autoCoverError) {
    console.error(
      '[finalize-upload] automatic cover update failed:',
      autoCoverError.message
    )
  }
}

    return NextResponse.json({
      success: true,
      duplicate: false,
      photoId: insertedPhoto.id,
      publicUrl,
      jobQueued: true,
      jobId: queueResult.jobId,
      processingStatus: 'pending',
      jobPriority,
    })
  } catch (error) {
    console.error(
  '[finalize-upload]',
  error instanceof Error ? error.message : error
)

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Finalize upload failed',
      },
      { status: 500 }
    )
  }
}
