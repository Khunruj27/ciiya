import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'
import {
  resolvePhotoUploadPrincipal,
  type PhotoUploadPrincipal,
} from '@/lib/photo-upload-principal'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import {
  createStorageRef,
  getR2Config,
  getStorageAdapter,
  isR2PhotoUploadEnabledForOwner,
  photoObjectKey,
  resolvePhotoDelivery,
} from '@/lib/storage'
import {
  estimatePhotoStorageBytes,
  getDirectPhotoExtension,
  hasMatchingPhotoExtension,
  hasUnsafeUploadPath,
  MAX_DIRECT_PHOTO_UPLOAD_BYTES,
  normalizeDirectPhotoMimeType,
  normalizePhotoFileHash,
  normalizeRequestedPhotoSize,
  SIGNED_PHOTO_UPLOAD_EXPIRES_SECONDS,
} from '@/lib/storage/photo-upload-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ReservationRow = {
  session_id: string
  reserved_object_key: string
  reserved_storage_bucket: string
  reserved_size_bytes: number | string
  remaining_bytes: number | string
  session_expires_at: string
  reused: boolean
}

type CancelledReservationRow = {
  storage_provider: string
  storage_bucket: string
  object_key: string
}

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...headers,
    },
  })
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

function rpcErrorCode(message: string) {
  return message.match(
    /(?:SYNC_DEVICE_UNAUTHORIZED|STORAGE_LIMIT_EXCEEDED|ALBUM_NOT_FOUND|CATEGORY_NOT_FOUND|INVALID_[A-Z_]+|UPLOAD_SESSION_CONFLICT|UPLOAD_SESSION_NOT_FOUND|UPLOAD_ALREADY_COMPLETED)/
  )?.[0]
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) || null
  if (value && typeof value === 'object') return value as T
  return null
}

async function cancelReservation(
  principal: PhotoUploadPrincipal,
  sessionId: string
) {
  const { data, error } =
    principal.kind === 'ciiya-sync'
      ? await principal.client.rpc('cancel_ciiya_sync_photo_upload', {
          p_device_id: principal.deviceId,
          p_session_id: sessionId,
        })
      : await principal.client.rpc('cancel_photo_upload_session', {
          p_session_id: sessionId,
        })

  if (error) return { row: null, error }

  return {
    row: firstRow<CancelledReservationRow>(data),
    error: null,
  }
}

export async function POST(request: NextRequest) {
  const browserClient = await createServerSupabaseClient()
  const { principal, rolloutDisabled } = await resolvePhotoUploadPrincipal({
    request,
    browserClient,
  })

  if (rolloutDisabled) {
    return json(
      {
        error: 'Ciiya Sync is temporarily paused',
        code: 'CIIYA_SYNC_ROLLOUT_PAUSED',
      },
      503,
      { 'Retry-After': '60' }
    )
  }

  if (!principal) {
    return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  if (principal.kind === 'ciiya-sync') {
    const rate = await rateLimit(request, {
      bucket: 'ciiya-sync-photo-upload',
      identifier: principal.deviceId,
      limit: 600,
      windowSeconds: 10 * 60,
    })

    if (!rate.allowed) {
      return tooManyRequests(rate, 'Ciiya Sync is uploading too quickly')
    }
  }

  const ownerId = principal.ownerId
  const supabase = principal.client

  if (!isR2PhotoUploadEnabledForOwner(ownerId)) {
    return json(
      {
        error: 'Direct R2 photo uploads are not enabled',
        code: 'R2_UPLOADS_DISABLED',
      },
      409
    )
  }

  let body: Record<string, unknown>

  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, 400)
  }

  const albumId = String(body.albumId || '').trim()
  const clientUploadId = String(body.clientUploadId || '').trim()
  const fileName = String(body.fileName || '').trim()
  const contentType = normalizeDirectPhotoMimeType(body.contentType)
  const fileSizeBytes = Number(body.fileSizeBytes)
  const lastModified = Number(body.lastModified || 0)
  const categoryId = body.categoryId
    ? String(body.categoryId).trim()
    : null
  const presetPath = body.presetPath
    ? String(body.presetPath).trim()
    : null
  const requestedSize = normalizeRequestedPhotoSize(body.size)
  const autoFaceScan = body.autoFaceScan !== false
  const autoPublish = body.autoPublish === true

  if (!isUuid(albumId) || !isUuid(clientUploadId)) {
    return json({ error: 'Invalid upload identifiers', code: 'INVALID_REQUEST' }, 400)
  }

  if (
    !fileName ||
    fileName.length > 255 ||
    !contentType ||
    !Number.isSafeInteger(fileSizeBytes) ||
    fileSizeBytes < 1 ||
    fileSizeBytes > MAX_DIRECT_PHOTO_UPLOAD_BYTES ||
    !hasMatchingPhotoExtension(fileName, contentType)
  ) {
    return json({ error: 'Invalid photo file', code: 'INVALID_PHOTO_FILE' }, 400)
  }

  if (categoryId && !isUuid(categoryId)) {
    return json({ error: 'Invalid category', code: 'INVALID_CATEGORY' }, 400)
  }

  if (principal.kind === 'ciiya-sync' && presetPath) {
    return json(
      {
        error: 'Ciiya Sync uploads must already contain Lightroom edits',
        code: 'SYNC_PRESET_NOT_ALLOWED',
      },
      400
    )
  }

  const expectedAlbumPresetPrefix = `${ownerId}/${albumId}/presets/`
  const expectedUserPresetPrefix = `${ownerId}/presets/`

  if (
    presetPath &&
    (presetPath.length > 500 ||
      hasUnsafeUploadPath(presetPath) ||
      (!presetPath.startsWith(expectedAlbumPresetPrefix) &&
        !presetPath.startsWith(expectedUserPresetPrefix)))
  ) {
    return json({ error: 'Invalid preset path', code: 'INVALID_PRESET_PATH' }, 400)
  }

  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select('id, owner_id, user_id')
    .eq('id', albumId)
    .maybeSingle()

  if (
    albumError ||
    !album ||
    (album.owner_id !== ownerId && album.user_id !== ownerId)
  ) {
    return json({ error: 'Album not found', code: 'ALBUM_NOT_FOUND' }, 404)
  }

  let fileHash: string

  try {
    fileHash = normalizePhotoFileHash({
      providedHash: body.fileHash,
      fileName,
      fileSizeBytes,
      lastModified,
    })
  } catch {
    return json({ error: 'Invalid file hash', code: 'INVALID_FILE_HASH' }, 400)
  }

  const { data: existingPhoto, error: duplicateError } = await supabase
    .from('photos')
    .select('id, storage_provider, storage_bucket, preview_url, thumbnail_url, preview_path, thumbnail_path, public_url, processing_status')
    .eq('album_id', albumId)
    .eq('file_hash', fileHash)
    .maybeSingle()

  if (duplicateError) {
    return json({ error: 'Unable to validate duplicate photo' }, 500)
  }

  if (existingPhoto) {
    const deliveryPhoto = resolvePhotoDelivery(existingPhoto)
    return json({
      success: true,
      duplicate: true,
      photoId: existingPhoto.id,
      publicUrl: deliveryPhoto.preview_url || deliveryPhoto.public_url,
      thumbnailUrl: deliveryPhoto.thumbnail_url,
      processingStatus: existingPhoto.processing_status,
    })
  }

  let plan: Awaited<ReturnType<typeof getUserStoragePlan>>
  let estimatedUploadBytes: number

  try {
    ;[plan, estimatedUploadBytes] = await Promise.all([
      getUserStoragePlan(ownerId),
      Promise.resolve(estimatePhotoStorageBytes(fileSizeBytes)),
    ])
  } catch (error) {
    console.error('[photo upload-url] quota validation failed:', error)
    return json({ error: 'Unable to validate storage quota' }, 500)
  }

  if (estimatedUploadBytes > plan.remainingBytes) {
    return json(
      {
        error: 'Storage full',
        code: 'STORAGE_LIMIT_EXCEEDED',
        plan: plan.plan,
        storageUsedBytes: plan.usedBytes,
        storageLimitBytes: plan.storageLimitBytes,
        estimatedUploadBytes,
        remainingBytes: plan.remainingBytes,
      },
      403
    )
  }

  let r2Config: ReturnType<typeof getR2Config>

  try {
    r2Config = getR2Config()
  } catch (error) {
    console.error('[photo upload-url] invalid R2 configuration:', error)
    return json(
      { error: 'R2 storage is not configured', code: 'R2_CONFIG_INVALID' },
      503
    )
  }
  const objectKey = photoObjectKey({
    ownerId,
    albumId,
    objectId: crypto.randomUUID(),
    kind: 'original',
    extension: getDirectPhotoExtension(contentType),
  })

  const reservationRequest = {
    p_album_id: albumId,
    p_client_upload_id: clientUploadId,
    p_storage_bucket: r2Config.bucketName,
    p_object_key: objectKey,
    p_original_file_name: fileName,
    p_content_type: contentType,
    p_expected_size_bytes: fileSizeBytes,
    p_file_hash: fileHash,
    p_requested_size: requestedSize,
    p_category_id: categoryId,
    p_auto_face_scan: autoFaceScan,
    p_auto_publish: autoPublish,
  }
  const { data: reservationData, error: reservationError } =
    principal.kind === 'ciiya-sync'
      ? await supabase.rpc('reserve_ciiya_sync_photo_upload', {
          p_device_id: principal.deviceId,
          ...reservationRequest,
        })
      : await supabase.rpc('reserve_photo_upload', {
          ...reservationRequest,
          p_preset_path: presetPath,
        })

  if (reservationError) {
    const code = rpcErrorCode(reservationError.message)
    const status =
      code === 'SYNC_DEVICE_UNAUTHORIZED'
        ? 401
        : code === 'STORAGE_LIMIT_EXCEEDED'
        ? 403
        : code === 'ALBUM_NOT_FOUND'
          ? 404
          : code?.startsWith('INVALID_') || code === 'CATEGORY_NOT_FOUND'
            ? 400
            : code === 'UPLOAD_SESSION_CONFLICT'
              ? 409
              : 500

    return json(
      {
        error:
          code === 'STORAGE_LIMIT_EXCEEDED'
            ? 'Storage full'
            : code || 'Unable to reserve photo upload',
        code: code || 'UPLOAD_RESERVATION_FAILED',
        plan: plan.plan,
        storageUsedBytes: plan.usedBytes,
        storageLimitBytes: plan.storageLimitBytes,
        estimatedUploadBytes,
        remainingBytes: plan.remainingBytes,
      },
      status
    )
  }

  const reservation = firstRow<ReservationRow>(reservationData)

  if (
    !reservation ||
    !isUuid(String(reservation.session_id || '')) ||
    !reservation.reserved_object_key ||
    !reservation.reserved_storage_bucket
  ) {
    return json({ error: 'Invalid upload reservation response' }, 500)
  }

  try {
    const ref = createStorageRef({
      provider: 'r2',
      bucket: reservation.reserved_storage_bucket,
      key: reservation.reserved_object_key,
    })
    const signed = await getStorageAdapter('r2').getSignedUploadUrl(ref, {
      contentType,
      contentLength: fileSizeBytes,
      expiresInSeconds: SIGNED_PHOTO_UPLOAD_EXPIRES_SECONDS,
      cacheControl: 'private, no-store',
    })

    return json({
      success: true,
      duplicate: false,
      provider: 'r2',
      bucket: ref.bucket,
      storagePath: ref.key,
      uploadSessionId: reservation.session_id,
      uploadUrl: signed.url,
      method: signed.method,
      headers: signed.headers,
      expiresAt:
        signed.expiresAt?.toISOString() ||
        new Date(
          Date.now() + SIGNED_PHOTO_UPLOAD_EXPIRES_SECONDS * 1000
        ).toISOString(),
      sessionExpiresAt: reservation.session_expires_at,
      reservedBytes: Number(reservation.reserved_size_bytes),
      remainingBytes: Number(reservation.remaining_bytes),
      reused: Boolean(reservation.reused),
      fileHash,
      plan: plan.plan,
    })
  } catch (error) {
    await cancelReservation(principal, reservation.session_id)
    console.error('[photo upload-url] signing failed:', error)
    return json({ error: 'Unable to create upload URL' }, 500)
  }
}

export async function DELETE(request: NextRequest) {
  const browserClient = await createServerSupabaseClient()
  const { principal, rolloutDisabled } = await resolvePhotoUploadPrincipal({
    request,
    browserClient,
  })

  if (rolloutDisabled) {
    return json(
      {
        error: 'Ciiya Sync is temporarily paused',
        code: 'CIIYA_SYNC_ROLLOUT_PAUSED',
      },
      503,
      { 'Retry-After': '60' }
    )
  }

  if (!principal) {
    return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  let sessionId = ''

  try {
    const body = (await request.json()) as { uploadSessionId?: unknown }
    sessionId = String(body.uploadSessionId || '').trim()
  } catch {
    return json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, 400)
  }

  if (!isUuid(sessionId)) {
    return json({ error: 'Invalid upload session', code: 'INVALID_REQUEST' }, 400)
  }

  const { row, error } = await cancelReservation(principal, sessionId)

  if (error || !row) {
    const code = rpcErrorCode(error?.message || '')
    const status = code === 'UPLOAD_SESSION_NOT_FOUND' ? 404 : 409
    return json(
      {
        error: code || 'Unable to cancel upload',
        code: code || 'UPLOAD_CANCEL_FAILED',
      },
      status
    )
  }

  try {
    const ref = createStorageRef({
      provider: 'r2',
      bucket: row.storage_bucket,
      key: row.object_key,
    })
    await getStorageAdapter('r2').deleteObject(ref)
  } catch (deleteError) {
    console.error('[photo upload-url] cancelled object cleanup failed:', deleteError)
    return json(
      {
        success: false,
        cancelled: true,
        cleanupPending: true,
        error: 'Upload cancelled; object cleanup will be retried',
      },
      502
    )
  }

  return json({ success: true, cancelled: true, cleanupPending: false })
}
