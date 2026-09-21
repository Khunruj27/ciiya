import {
  assertOwnedAlbumObjectKey,
  createStorageRef,
  isPublicDeliveryKey,
} from './paths'
import type {
  StorageAdapter,
  StorageObjectHead,
  StorageObjectRef,
} from './types'

const PHOTO_PATH_FIELDS = [
  'storage_path',
  'original_path',
  'preview_path',
  'thumbnail_path',
  'sd_path',
  'hd_path',
  'uhd_path',
] as const

type PhotoPathField = (typeof PHOTO_PATH_FIELDS)[number]

export type PhotoStorageMigrationRow = {
  id: string
  owner_id?: string | null
  user_id?: string | null
  album_id: string
  storage_provider?: unknown
  storage_bucket?: string | null
  storage_version?: number | null
  migration_status?: string | null
  storage_path?: string | null
  original_path?: string | null
  preview_path?: string | null
  thumbnail_path?: string | null
  sd_path?: string | null
  hd_path?: string | null
  uhd_path?: string | null
  file_size_bytes?: number | string | null
  original_size_bytes?: number | string | null
  preview_size_bytes?: number | string | null
  thumbnail_size_bytes?: number | string | null
  mime_type?: string | null
}

export type PhotoMigrationObjectPlan = {
  key: string
  fields: PhotoPathField[]
  sourceCandidates: StorageObjectRef[]
  target: StorageObjectRef
  expectedSizeBytes: number | null
}

export type PhotoMigrationInspection = {
  plan: PhotoMigrationObjectPlan
  source: StorageObjectRef
  sourceHead: StorageObjectHead
  targetHead: StorageObjectHead
  disposition: 'copy' | 'reuse'
}

export type PhotoMigrationCopyResult = {
  copied: number
  reused: number
  bytes: number
  objects: PhotoMigrationInspection[]
}

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function expectedSizeForKey(photo: PhotoStorageMigrationRow, key: string) {
  if (key.includes('/original/')) {
    return (
      positiveInteger(photo.original_size_bytes) ||
      positiveInteger(photo.file_size_bytes)
    )
  }
  if (key.includes('/preview/')) {
    return positiveInteger(photo.preview_size_bytes)
  }
  if (key.includes('/thumbnail/')) {
    return positiveInteger(photo.thumbnail_size_bytes)
  }
  return null
}

function sourceCandidatesForKey(key: string) {
  const buckets = key.includes('/original/')
    ? ['originals', 'albums']
    : ['albums']

  return buckets.map((bucket) =>
    createStorageRef({ provider: 'supabase', bucket, key })
  )
}

function contentTypeForKey(key: string, sourceType?: string | null) {
  const normalizedSourceType = sourceType?.trim().toLowerCase()
  if (normalizedSourceType?.includes('/')) return normalizedSourceType

  const extension = key.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'heic' || extension === 'heif') return `image/${extension}`
  if (extension === 'xmp') return 'application/rdf+xml'
  return 'application/octet-stream'
}

function requireKnownSize(head: StorageObjectHead, label: string) {
  const size = head.sizeBytes
  if (!Number.isSafeInteger(size) || Number(size) <= 0) {
    throw new Error(`${label} did not return a positive Content-Length`)
  }
  return Number(size)
}

function assertExpectedSize(
  plan: PhotoMigrationObjectPlan,
  actualSizeBytes: number
) {
  if (
    plan.expectedSizeBytes !== null &&
    plan.expectedSizeBytes !== actualSizeBytes
  ) {
    throw new Error(
      `Source size mismatch for ${plan.key}: expected ${plan.expectedSizeBytes}, got ${actualSizeBytes}`
    )
  }
}

export function planPhotoStorageMigration(
  photo: PhotoStorageMigrationRow,
  targetBucket: string
) {
  if (photo.storage_provider !== 'supabase') {
    throw new Error(`Photo ${photo.id} is not stored in Supabase`)
  }

  const ownerId = photo.owner_id || photo.user_id
  if (!ownerId) throw new Error(`Photo ${photo.id} has no owner`)
  if (!photo.album_id) throw new Error(`Photo ${photo.id} has no album`)

  const byKey = new Map<string, PhotoMigrationObjectPlan>()

  for (const field of PHOTO_PATH_FIELDS) {
    const rawPath = photo[field]?.trim()
    if (!rawPath) continue

    const key = assertOwnedAlbumObjectKey(rawPath, ownerId, photo.album_id)
    const existing = byKey.get(key)

    if (existing) {
      existing.fields.push(field)
      continue
    }

    const sourceCandidates = sourceCandidatesForKey(key)
    if (sourceCandidates.length === 0) {
      throw new Error(`No Supabase source candidate for ${key}`)
    }

    byKey.set(key, {
      key,
      fields: [field],
      sourceCandidates,
      target: createStorageRef({
        provider: 'r2',
        bucket: targetBucket,
        key,
      }),
      expectedSizeBytes: expectedSizeForKey(photo, key),
    })
  }

  const objects = Array.from(byKey.values())
  if (objects.length === 0) {
    throw new Error(`Photo ${photo.id} has no storage object paths`)
  }

  return objects
}

async function inspectObject(
  plan: PhotoMigrationObjectPlan,
  sourceAdapter: StorageAdapter,
  targetAdapter: StorageAdapter
): Promise<PhotoMigrationInspection> {
  let source: StorageObjectRef | null = null
  let sourceHead: StorageObjectHead | null = null

  for (const candidate of plan.sourceCandidates) {
    const head = await sourceAdapter.objectExists(candidate)
    if (!head.exists) continue
    source = candidate
    sourceHead = head
    break
  }

  if (!source || !sourceHead) {
    throw new Error(`Supabase source object is missing: ${plan.key}`)
  }

  const sourceSize = requireKnownSize(sourceHead, `Supabase object ${plan.key}`)
  assertExpectedSize(plan, sourceSize)

  const targetHead = await targetAdapter.objectExists(plan.target)
  if (targetHead.exists) {
    const targetSize = requireKnownSize(targetHead, `R2 object ${plan.key}`)
    if (targetSize !== sourceSize) {
      throw new Error(
        `R2 size conflict for ${plan.key}: source ${sourceSize}, target ${targetSize}`
      )
    }
  }

  return {
    plan,
    source,
    sourceHead,
    targetHead,
    disposition: targetHead.exists ? 'reuse' : 'copy',
  }
}

export async function inspectPhotoStorageMigration(params: {
  photo: PhotoStorageMigrationRow
  targetBucket: string
  sourceAdapter: StorageAdapter
  targetAdapter: StorageAdapter
}) {
  const plans = planPhotoStorageMigration(params.photo, params.targetBucket)
  const inspections: PhotoMigrationInspection[] = []

  for (const plan of plans) {
    inspections.push(
      await inspectObject(plan, params.sourceAdapter, params.targetAdapter)
    )
  }

  return inspections
}

export async function copyPhotoStorageMigration(params: {
  photo: PhotoStorageMigrationRow
  targetBucket: string
  sourceAdapter: StorageAdapter
  targetAdapter: StorageAdapter
  maxObjectBytes: number
}): Promise<PhotoMigrationCopyResult> {
  if (!Number.isSafeInteger(params.maxObjectBytes) || params.maxObjectBytes < 1) {
    throw new Error('maxObjectBytes must be a positive safe integer')
  }

  const objects = await inspectPhotoStorageMigration(params)
  let copied = 0
  let reused = 0
  let bytes = 0

  for (const object of objects) {
    const sourceSize = requireKnownSize(
      object.sourceHead,
      `Supabase object ${object.plan.key}`
    )
    if (sourceSize > params.maxObjectBytes) {
      throw new Error(
        `Object ${object.plan.key} is ${sourceSize} bytes, above the configured migration limit`
      )
    }

    bytes += sourceSize

    if (object.disposition === 'reuse') {
      reused += 1
      continue
    }

    const body = await params.sourceAdapter.downloadObject(object.source)
    if (body.byteLength !== sourceSize) {
      throw new Error(
        `Downloaded size mismatch for ${object.plan.key}: expected ${sourceSize}, got ${body.byteLength}`
      )
    }

    await params.targetAdapter.uploadObject(object.plan.target, body, {
      contentType: contentTypeForKey(
        object.plan.key,
        object.sourceHead.contentType || params.photo.mime_type
      ),
      cacheControl: isPublicDeliveryKey(object.plan.key)
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
      upsert: false,
      metadata: {
        migratedFrom: 'supabase',
        photoId: params.photo.id,
      },
    })
    copied += 1
  }

  return { copied, reused, bytes, objects }
}

export async function verifyPhotoStorageMigration(params: {
  photo: PhotoStorageMigrationRow
  targetBucket: string
  sourceAdapter: StorageAdapter
  targetAdapter: StorageAdapter
}) {
  const objects = await inspectPhotoStorageMigration(params)

  for (const object of objects) {
    if (!object.targetHead.exists) {
      throw new Error(`R2 verification failed; object is missing: ${object.plan.key}`)
    }
  }

  return {
    verified: objects.length,
    bytes: objects.reduce(
      (sum, object) => sum + requireKnownSize(object.targetHead, object.plan.key),
      0
    ),
    objects,
  }
}

export function buildPhotoStorageMigrationCompletion(
  photo: PhotoStorageMigrationRow,
  targetBucket: string,
  targetAdapter: StorageAdapter
) {
  const plans = planPhotoStorageMigration(photo, targetBucket)
  const preview = plans.find((object) => object.key.includes('/preview/'))
  const thumbnail = plans.find((object) => object.key.includes('/thumbnail/'))
  const previewUrl = preview
    ? targetAdapter.getPublicUrl(preview.target)
    : null
  const thumbnailUrl = thumbnail
    ? targetAdapter.getPublicUrl(thumbnail.target)
    : null

  if (preview && !previewUrl) {
    throw new Error('R2_PUBLIC_BASE_URL is required to publish migrated previews')
  }
  if (thumbnail && !thumbnailUrl) {
    throw new Error('R2_PUBLIC_BASE_URL is required to publish migrated thumbnails')
  }

  const publicUrl = previewUrl || thumbnailUrl

  return {
    storage_provider: 'r2' as const,
    storage_bucket: targetBucket,
    storage_version: Math.max(1, Number(photo.storage_version || 1)),
    migration_status: 'completed' as const,
    migration_error: null,
    migration_completed_at: new Date().toISOString(),
    preview_url: previewUrl,
    thumbnail_url: thumbnailUrl,
    public_url: publicUrl,
    image_url: publicUrl,
    original_url: null,
    sd_url: null,
    hd_url: null,
    uhd_url: null,
  }
}
