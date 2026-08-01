import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const MAX_PRESET_BYTES = 5 * 1024 * 1024
const STORAGE_BUCKET = 'albums'

type UploadSize = 'sd' | 'hd' | 'uhd' | 'original'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return null
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function getSafeUploadSize(value: string): UploadSize {
  const safeValue = value.trim().toLowerCase()

  if (
    safeValue === 'sd' ||
    safeValue === 'hd' ||
    safeValue === 'uhd' ||
    safeValue === 'original'
  ) {
    return safeValue
  }

  return 'original'
}

function getFileHash(buffer: Buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex')
}

function hasValidImageSignature(
  buffer: Buffer,
  mimeType: string
) {
  if (mimeType === 'image/jpeg') {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    )
  }

  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    )
  }

  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  }

  return false
}

function getImageExtensionFromMime(
  mimeType: string
) {
  if (mimeType === 'image/jpeg') {
    return 'jpg'
  }

  if (mimeType === 'image/png') {
    return 'png'
  }

  if (mimeType === 'image/webp') {
    return 'webp'
  }

  return null
}

function hasMatchingImageExtension(
  fileName: string,
  mimeType: string
) {
  const lowerFileName = fileName
    .trim()
    .toLowerCase()

  if (mimeType === 'image/jpeg') {
    return (
      lowerFileName.endsWith('.jpg') ||
      lowerFileName.endsWith('.jpeg')
    )
  }

  if (mimeType === 'image/png') {
    return lowerFileName.endsWith('.png')
  }

  if (mimeType === 'image/webp') {
    return lowerFileName.endsWith('.webp')
  }

  return false
}

function getSafeFileName(
  fileName: string,
  mimeType: string
) {
  const ext =
    getImageExtensionFromMime(mimeType) ||
    'jpg'

  const baseName = fileName.replace(
    /\.[^/.]+$/,
    ''
  )

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  const randomPart = crypto
    .randomBytes(6)
    .toString('hex')

  return `${
    Date.now()
  }-${randomPart}-${
    safeBaseName || 'photo'
  }.${ext}`
}

function getSafePresetName(fileName: string) {
  const baseName = fileName.replace(/\.[^/.]+$/, '')

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  const randomPart = crypto.randomBytes(6).toString('hex')

  return `${Date.now()}-${randomPart}-${safeBaseName || 'preset'}.xmp`
}

function hasValidXmpContent(
  buffer: Buffer
) {
  if (buffer.includes(0x00)) {
    return false
  }

  const content = buffer
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trim()

  if (!content) {
    return false
  }

  return (
    content.startsWith('<?xpacket') ||
    content.startsWith('<?xml') ||
    content.includes('<x:xmpmeta') ||
    content.includes('<rdf:RDF')
  )
}

async function getStorageUsageAndLimit(userId: string) {
  const normalizedUserId = userId.trim()

  if (!normalizedUserId) {
    throw new Error('Invalid userId')
  }

  const supabase = await createServerSupabaseClient()

  const { data: usage, error: usageError } = await supabase
    .from('user_storage_usage')
    .select('used_bytes, storage_used_bytes')
    .eq('user_id', normalizedUserId)
    .maybeSingle()

  if (usageError) {
    throw new Error(
      `Failed to load storage usage: ${usageError.message}`
    )
  }

  const storedUsageValue =
    usage?.storage_used_bytes ??
    usage?.used_bytes ??
    null

  let usedBytes: number

  if (storedUsageValue === null) {
    const { data, error } = await supabase
      .from('photos')
      .select(`
        original_size_bytes,
        file_size_bytes,
        preview_size_bytes,
        thumbnail_size_bytes
      `)
      .or(
        `owner_id.eq.${normalizedUserId},user_id.eq.${normalizedUserId}`
      )

    if (error) {
      throw new Error(
        `Failed to calculate storage usage: ${error.message}`
      )
    }

    usedBytes = (data ?? []).reduce((sum, row) => {
      const originalBytes = Number(
        row.original_size_bytes ??
          row.file_size_bytes ??
          0
      )

      const previewBytes = Number(
        row.preview_size_bytes ?? 0
      )

      const thumbnailBytes = Number(
        row.thumbnail_size_bytes ?? 0
      )

      if (
        !Number.isSafeInteger(originalBytes) ||
        originalBytes < 0 ||
        !Number.isSafeInteger(previewBytes) ||
        previewBytes < 0 ||
        !Number.isSafeInteger(thumbnailBytes) ||
        thumbnailBytes < 0
      ) {
        throw new Error('Invalid photo storage usage data')
      }

      const nextTotal =
        sum +
        originalBytes +
        previewBytes +
        thumbnailBytes

      if (!Number.isSafeInteger(nextTotal)) {
        throw new Error(
          'Storage usage exceeds safe integer range'
        )
      }

      return nextTotal
    }, 0)
  } else {
    usedBytes = Number(storedUsageValue)

    if (
      !Number.isSafeInteger(usedBytes) ||
      usedBytes < 0
    ) {
      throw new Error('Invalid stored storage usage')
    }
  }

  const { storageLimitBytes } =
    await getUserStoragePlan(normalizedUserId)

  const limitBytes = Number(storageLimitBytes)

  if (
    !Number.isSafeInteger(limitBytes) ||
    limitBytes < 0
  ) {
    throw new Error('Invalid storage limit')
  }

  return {
    usedBytes,
    limitBytes,
  }
}

async function findDuplicatePhoto(params: {
  albumId: string
  userId: string
  fileHash: string
}) {
  const { albumId, userId, fileHash } = params

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('photos')
    .select(`
      id,
      public_url,
      original_url,
      preview_url,
      thumbnail_url,
      processing_status
    `)
    .eq('album_id', albumId)
    .eq('file_hash', fileHash)
    .or(`owner_id.eq.${userId},user_id.eq.${userId}`)
    .maybeSingle()

  if (error) {
  console.error(
    '[photos/upload] duplicate lookup failed:',
    error.message
  )

  throw new Error('Duplicate lookup failed')
}

  return data
}

export async function POST(req: NextRequest) {
  let uploadedStoragePath: string | null = null
  let uploadedPresetPath: string | null = null
  let imageBuffer: Buffer | null = null
  let presetBuffer: Buffer | null = null

  try {
    const supabase = await createServerSupabaseClient()

    const {
  data: { user },
  error: authError,
} = await supabase.auth.getUser()

if (authError) {
  console.error(
    '[photos/upload] authentication failed:',
    authError.message
  )

  return NextResponse.json(
    { error: 'Unable to verify authentication' },
    { status: 500 }
  )
}

if (!user) {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401 }
  )
}

    const formData = await req.formData().catch(() => null)

if (!formData) {
  return NextResponse.json(
    { error: 'Invalid upload request' },
    { status: 400 }
  )
}

    const fileValue = formData.get('file')
const presetFileValue = formData.get('presetFile')

const file =
  fileValue instanceof File
    ? fileValue
    : null

const presetFile =
  presetFileValue instanceof File
    ? presetFileValue
    : null

    const albumId = String(formData.get('albumId') || '').trim()

    const size = getSafeUploadSize(
      String(formData.get('size') || 'original')
    )

    const categoryIdRaw = String(
      formData.get('categoryId') || ''
    ).trim()

    const categoryId = categoryIdRaw || null

    const isCover =
      String(formData.get('isCover') || '') === 'true'
      
      if (
  albumId.length > 100 ||
  categoryIdRaw.length > 100 ||
  (file && file.name.length > 255) ||
  (presetFile && presetFile.name.length > 255)
) {
  return NextResponse.json(
    { error: 'Invalid upload data' },
    { status: 400 }
  )
}

    if (!file || !albumId) {
      return NextResponse.json(
        { error: 'Missing file or albumId' },
        { status: 400 }
      )
    }

    if (file.size <= 0) {
  return NextResponse.json(
    { error: 'File is empty' },
    { status: 400 }
  )
}

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: 'File too large. Maximum 100MB allowed.',
        },
        { status: 400 }
      )
    }

    const fileNameLower = file.name.toLowerCase()

    const normalizedMimeType = file.type
  .trim()
  .toLowerCase()

  const allowedExtensions = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]

const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

const hasAllowedExtension = allowedExtensions.some((extension) =>
  fileNameLower.endsWith(extension)
)

const hasAllowedMimeType =
  allowedMimeTypes.includes(normalizedMimeType)

if (
  !hasAllowedExtension ||
  !hasAllowedMimeType ||
  !hasMatchingImageExtension(
    file.name,
    normalizedMimeType
  )
) {
  return NextResponse.json(
    {
      error: 'Only JPEG, PNG and WEBP images are allowed',
    },
    { status: 400 }
  )
}

if (presetFile) {
  const presetNameLower = presetFile.name.toLowerCase()
 const presetMimeType = presetFile.type
  .trim()
  .toLowerCase()

  const allowedPresetMimeTypes = [
    '',
    'application/octet-stream',
    'application/xml',
    'text/xml',
  ]

  if (!presetNameLower.endsWith('.xmp')) {
    return NextResponse.json(
      { error: 'Only .xmp preset files are allowed' },
      { status: 400 }
    )
  }

  if (!allowedPresetMimeTypes.includes(presetMimeType)) {
    return NextResponse.json(
      { error: 'Invalid preset file type' },
      { status: 400 }
    )
  }

  if (presetFile.size <= 0) {
    return NextResponse.json(
      { error: 'Preset file is empty' },
      { status: 400 }
    )
  }

  if (presetFile.size > MAX_PRESET_BYTES) {
    return NextResponse.json(
      { error: 'Preset file too large. Maximum 5MB allowed.' },
      { status: 400 }
    )
  }
}

    const {
  data: album,
  error: albumError,
} = await supabase
  .from('albums')
  .select(
    'id, owner_id, user_id, cover_url'
  )
  .eq('id', albumId)
  .or(
    `owner_id.eq.${user.id},user_id.eq.${user.id}`
  )
  .maybeSingle()

if (albumError) {
  console.error(
    '[photos/upload] album lookup failed:',
    albumError.message
  )

  return NextResponse.json(
    { error: 'Unable to verify album' },
    { status: 500 }
  )
}

if (!album) {
  return NextResponse.json(
    { error: 'Album not found' },
    { status: 404 }
  )
}

   const buffer = Buffer.from(await file.arrayBuffer())
   imageBuffer = buffer

  const originalSizeBytes = buffer.length

if (
  originalSizeBytes !== file.size ||
  !hasValidImageSignature(buffer, normalizedMimeType)
) {
  buffer.fill(0)

  return NextResponse.json(
    { error: 'Invalid or corrupted image file' },
    { status: 400 }
  )
}

const fileHash = getFileHash(buffer)

    if (!isCover) {
      const duplicatePhoto = await findDuplicatePhoto({
        albumId,
        userId: user.id,
        fileHash,
      })

      if (duplicatePhoto) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          photoId: duplicatePhoto.id,
          publicUrl:
            duplicatePhoto.preview_url ||
            duplicatePhoto.public_url ||
            duplicatePhoto.original_url,
          thumbnailUrl: duplicatePhoto.thumbnail_url,
          processingStatus:
            duplicatePhoto.processing_status || 'done',
          message: 'Duplicate photo skipped.',
        })
      }

      const { usedBytes, limitBytes } =
        await getStorageUsageAndLimit(user.id)

      const estimatedPreviewBytes = Math.round(
        originalSizeBytes * 0.35
      )

      const estimatedThumbnailBytes = Math.round(
        originalSizeBytes * 0.05
      )

     const estimatedTotal =
  originalSizeBytes +
  estimatedPreviewBytes +
  estimatedThumbnailBytes

const estimatedNextUsage = usedBytes + estimatedTotal

if (
  !Number.isSafeInteger(estimatedTotal) ||
  !Number.isSafeInteger(estimatedNextUsage)
) {
  buffer.fill(0)

  throw new Error(
    'Storage calculation exceeds safe integer range'
  )
}

if (estimatedNextUsage > limitBytes) {
        return NextResponse.json(
          {
            error: 'Storage full. Please upgrade your plan.',
            usedBytes,
            limitBytes,
            estimatedUploadBytes: estimatedTotal,
          },
          { status: 400 }
        )
      }
    }

    const fileName = getSafeFileName(
  file.name,
  normalizedMimeType
)

    const storagePath = isCover
      ? `${user.id}/${albumId}/cover/${fileName}`
      : `${user.id}/${albumId}/original/${fileName}`

    uploadedStoragePath = storagePath

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: normalizedMimeType,
        upsert: false,
      })

    if (uploadError) {
  console.error(
    '[photos/upload] original upload failed:',
    uploadError.message
  )

  return NextResponse.json(
    { error: 'Unable to upload photo' },
    { status: 500 }
  )
}

    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath)

    const publicUrl = publicUrlData.publicUrl

  if (isCover) {
  const { error: coverError } = await supabase
    .from('albums')
    .update({
      cover_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', albumId)
    .or(
      `owner_id.eq.${user.id},user_id.eq.${user.id}`
    )

  if (coverError) {
    const { error: cleanupError } =
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath])

    if (cleanupError) {
  console.error(
    '[photos/upload] cover rollback failed:',
    cleanupError.message
  )
} else {
  uploadedStoragePath = null
}

    console.error(
      '[photos/upload] cover update failed:',
      coverError.message
    )

    return NextResponse.json(
      { error: 'Unable to update album cover' },
      { status: 500 }
    )
  }

  uploadedStoragePath = null

  return NextResponse.json({
    success: true,
    coverUrl: publicUrl,
  })
}

    let presetPath: string | null = null
    let presetUploadError: string | null = null

    if (presetFile) {
      presetBuffer = Buffer.from(
  await presetFile.arrayBuffer()
)

if (presetBuffer.length !== presetFile.size) {
  return NextResponse.json(
    { error: 'Invalid or corrupted preset file' },
    { status: 400 }
  )
}

if (!hasValidXmpContent(presetBuffer)) {
  return NextResponse.json(
    { error: 'Invalid XMP preset content' },
    { status: 400 }
  )
}

const presetName = getSafePresetName(presetFile.name)

      presetPath = `${user.id}/${albumId}/presets/${presetName}`

      const { error: presetError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(presetPath, presetBuffer, {
          contentType: 'application/octet-stream',
          upsert: true,
        })

      if (presetError) {
  presetUploadError = presetError.message
  presetPath = null

  console.error(
    'Preset upload error:',
    presetError.message
  )
} else {
  uploadedPresetPath = presetPath
}
    }

    const { data: insertedPhoto, error: insertError } =
      await supabase
        .from('photos')
        .insert({
          album_id: albumId,

          owner_id: user.id,
          user_id: user.id,

          filename: file.name,
          file_name: file.name,

          storage_path: storagePath,
          original_path: storagePath,

          public_url: publicUrl,
          original_url: publicUrl,
          image_url: publicUrl,

          category_id: categoryId,

          file_hash: fileHash,

          file_size_bytes: originalSizeBytes,
          original_size_bytes: originalSizeBytes,
          preview_size_bytes: 0,
          thumbnail_size_bytes: 0,

          mime_type: normalizedMimeType,

          processing_status: 'pending',
          processing_progress: 0,

          metadata: {
            originalName: file.name,
            uploadedVia: 'api/photos/upload',
            requestedSize: size,
          },
        })
        .select('id, public_url, original_url')
        .single()

    if (insertError) {
  const pathsToRemove = [
    storagePath,
    ...(uploadedPresetPath
      ? [uploadedPresetPath]
      : []),
  ]

  const { error: cleanupError } =
    await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(pathsToRemove)

  if (cleanupError) {
  console.error(
    '[photos/upload] rollback cleanup failed:',
    cleanupError.message
  )
} else {
  uploadedStoragePath = null
  uploadedPresetPath = null
}

  if (
    insertError.message
      .toLowerCase()
      .includes('duplicate') ||
    insertError.code === '23505'
  ) {
    const duplicatePhoto = await findDuplicatePhoto({
      albumId,
      userId: user.id,
      fileHash,
    })

    return NextResponse.json({
      success: true,
      duplicate: true,
      photoId: duplicatePhoto?.id ?? null,
      publicUrl:
        duplicatePhoto?.preview_url ||
        duplicatePhoto?.public_url ||
        duplicatePhoto?.original_url ||
        publicUrl,
      processingStatus:
        duplicatePhoto?.processing_status ||
        'pending',
      message: 'Duplicate photo skipped.',
    })
  }

  console.error(
    '[photos/upload] photo insert failed:',
    insertError.message
  )

  return NextResponse.json(
    { error: 'Unable to save uploaded photo' },
    { status: 500 }
  )
}

uploadedStoragePath = null
uploadedPresetPath = null

  if (!album.cover_url && insertedPhoto?.public_url) {
  const { error: autoCoverError } = await supabase
    .from('albums')
    .update({
      cover_url: insertedPhoto.public_url,
      cover_photo_id: insertedPhoto.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', albumId)
    .or(`owner_id.eq.${user.id},user_id.eq.${user.id}`)

  if (autoCoverError) {
    console.error(
      'Automatic album cover update failed:',
      autoCoverError.message
    )
  }
}

  let jobQueued = false
let jobError: string | null = null

const supabaseAdmin = getSupabaseAdmin()

if (insertedPhoto?.id) {

      if (!supabaseAdmin) {
        jobError = 'Missing SUPABASE_SERVICE_ROLE_KEY'
        console.error(jobError)
      } else {
        const { error: queueError } = await supabaseAdmin
  .from('photo_jobs')
  .upsert(
    {
      photo_id: insertedPhoto.id,
      owner_id: user.id,
      album_id: albumId,
      original_path: storagePath,
      size,
      preset_path: presetPath,
      status: 'pending',
      priority: 100,
      progress: 0,
      retry_count: 0,
      retries: 0,
      started_at: null,
      finished_at: null,
      error: null,
      worker_id: null,
      claimed_by: null,
      payload: {
        source: 'api-photos-upload',
        fileHash,
        originalName: file.name,
        publicUrl,
        requestedSize: size,
        presetPath,
      },
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'photo_id',
    }
  )

        if (queueError) {
          jobError = queueError.message

          console.error(
            'Insert photo_jobs error:',
            queueError.message
          )
        } else {
          jobQueued = true
        }
      }
    }

   if (supabaseAdmin) {
  const { error: recalculateError } = await supabaseAdmin.rpc(
    'recalculate_user_storage',
    {
      user_uuid: user.id,
    }
  )

  if (recalculateError) {
    console.error(
      'Storage recalculation failed:',
      recalculateError.message
    )
  }
}

if (!jobQueued && insertedPhoto?.id) {
  const { error: queueStateError } =
    await supabase
      .from('photos')
      .update({
        processing_status:
          'original_uploaded',
        processing_progress: 0,
        updated_at:
          new Date().toISOString(),
      })
      .eq('id', insertedPhoto.id)
      .or(
        `owner_id.eq.${user.id},user_id.eq.${user.id}`
      )

  if (queueStateError) {
    console.error(
      '[photos/upload] queue failure state update failed:',
      queueStateError.message
    )
  }
}

    return NextResponse.json({
      success: true,
      duplicate: false,
      publicUrl,
      photoId: insertedPhoto?.id ?? null,
      originalSizeBytes,
      fileHash,
      presetQueued: Boolean(presetPath),
      presetUploadError,
      processingStatus: jobQueued
        ? 'pending'
        : 'original_uploaded',
      jobQueued,
      jobError,
      message: jobQueued
        ? 'Upload completed. Photo queued for Railway worker.'
        : 'Upload completed. Photo saved without worker job.',
    })
  } catch (error) {
    console.error(
  '[photos/upload] unexpected error:',
  error
)

    const pendingCleanupPaths = [
      ...(uploadedStoragePath ? [uploadedStoragePath] : []),
      ...(uploadedPresetPath ? [uploadedPresetPath] : []),
    ]

    if (pendingCleanupPaths.length > 0) {
      try {
        const supabase = await createServerSupabaseClient()

        const { error: cleanupError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(pendingCleanupPaths)

        if (cleanupError) {
          console.error(
            'Upload cleanup failed:',
            cleanupError.message
          )
        }
      } catch (cleanupError) {
        console.error(
          'Upload cleanup failed:',
          cleanupError
        )
      }
    }

    return NextResponse.json(
  { error: 'Upload failed' },
  { status: 500 }
)

  } finally {
    imageBuffer?.fill(0)
    presetBuffer?.fill(0)

    imageBuffer = null
    presetBuffer = null
  }
}