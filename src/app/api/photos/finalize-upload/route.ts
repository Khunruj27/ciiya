import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RequestedSize = 'sd' | 'hd' | 'uhd' | 'original'

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

  processing_status?: string | null
}

type SupabaseAdminClient = SupabaseClient

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
     * อีก Request อาจสร้าง Job สำเร็จ
     * หลังจากที่ Request นี้ตรวจ Active Job ไปแล้ว
     * จึงตรวจซ้ำก่อนถือว่า Enqueue ล้มเหลว
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

    const {
  data: { user },
} = await supabase.auth.getUser()

if (!user && !isWorkerRequest) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

    const body = await req.json().catch(() => null)

if (!body) {
  return NextResponse.json(
    { error: 'Invalid request body' },
    { status: 400 }
  )
}

    const albumId = String(body.albumId || '').trim()
    const storagePath = String(body.storagePath || '').trim()
    const fileName = String(body.fileName || '').trim()
    const fileSizeBytes = Number(body.fileSizeBytes || 0)
    const MAX_UPLOAD_BYTES = 200 * 1024 * 1024 // 200MB

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

const fileHash = /^[a-f0-9]{64}$/i.test(
  hashSource
)
  ? hashSource.toLowerCase()
  : crypto
      .createHash('sha256')
      .update(hashSource, 'utf8')
      .digest('hex')

    const size = normalizeRequestedSize(String(body.size || 'hd').toLowerCase())
    const categoryId = body.categoryId
  ? String(body.categoryId).trim().slice(0, 100)
  : null
    const presetPath = body.presetPath ? String(body.presetPath).trim() : null

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

    if (fileSizeBytes > MAX_UPLOAD_BYTES) {
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

if (!isWorkerRequest) {
  const canAccess =
    album.owner_id === user?.id ||
    album.user_id === user?.id

  if (!canAccess) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  }
}
    
    const ownerId =
  album.owner_id || album.user_id || user?.id || null

if (!ownerId) {
  return NextResponse.json(
    { error: 'Missing album owner' },
    { status: 500 }
  )
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

const presetBucket = presetPath
  ? presetPath.startsWith(expectedUserPresetPrefix)
    ? 'presets'
    : 'albums'
  : null

const [
  originalFileExists,
  presetFileExists,
  existingPhotoResult,
] = await Promise.all([
  storageObjectExists(supabaseAdmin, storagePath),
  presetPath
    ? storageObjectExists(supabaseAdmin, presetPath, presetBucket!)
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
      processing_status,
      original_path,
      storage_path,
      preset_path
    `
    )
    .eq('album_id', albumId)
    .eq('file_hash', fileHash)
    .maybeSingle(),
])

if (!originalFileExists) {
  return NextResponse.json(
    { error: 'Uploaded file not found in storage' },
    { status: 400 }
  )
}

if (presetPath && !presetFileExists) {
  return NextResponse.json(
    {
      error:
        'Preset file not found in storage',
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

    const { data: publicUrlData } = supabaseAdmin.storage
      .from('albums')
      .getPublicUrl(storagePath)

    const publicUrl = publicUrlData.publicUrl

    if (existingPhoto) {
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
          source: 'finalize-upload-duplicate-repair',
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

      return NextResponse.json({
        success: true,
        duplicate: true,
        repaired: needsRepair,
        jobQueued: queueResult?.queued || false,
        jobId: queueResult?.jobId || null,
        jobError: queueResult?.error || null,
        photoId: existingPhoto.id,
        publicUrl:
          existingPhoto.preview_url ||
          existingPhoto.public_url ||
          existingPhoto.original_url ||
          publicUrl,
        thumbnailUrl: existingPhoto.thumbnail_url,
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
          uploadedVia: 'api/photos/finalize-upload',
          requestedSize: size,
          presetPath,
          jobPriority,
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
      source: 'finalize-upload',
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
          uploadedVia: 'api/photos/finalize-upload',
          requestedSize: size,
          presetPath,
          jobPriority,
          queueError: queueResult.error,
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