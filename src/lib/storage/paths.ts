import type { StorageObjectRef, StorageProvider } from './types'

export const PHOTO_OBJECT_KINDS = [
  'original',
  'preview',
  'thumbnail',
  'sd',
  'hd',
  'uhd',
] as const

export type PhotoObjectKind = (typeof PHOTO_OBJECT_KINDS)[number]

const FACE_SOURCE_OBJECT_KINDS = [
  'uhd',
  'hd',
  'preview',
  'original',
] as const satisfies readonly PhotoObjectKind[]

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SAFE_EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}`)
  }

  return value.toLowerCase()
}

function assertSafeExtension(value: string) {
  const extension = value.trim().toLowerCase().replace(/^\./, '')

  if (!SAFE_EXTENSION_PATTERN.test(extension)) {
    throw new Error('Invalid object extension')
  }

  return extension
}

export function normalizeObjectKey(value: string) {
  const key = value.trim().replace(/^\/+/, '')
  const lowerKey = key.toLowerCase()

  if (
    !key ||
    key.length > 1024 ||
    key.endsWith('/') ||
    key.includes('\\') ||
    key.includes('//') ||
    key.includes('\0') ||
    key.includes('?') ||
    key.includes('#') ||
    lowerKey.includes('%2e') ||
    lowerKey.includes('%2f') ||
    lowerKey.includes('%5c') ||
    key.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid storage object key')
  }

  return key
}

export function assertStorageBucket(value: string) {
  const bucket = value.trim()

  if (
    bucket.length < 3 ||
    bucket.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) ||
    bucket.includes('..')
  ) {
    throw new Error('Invalid storage bucket')
  }

  return bucket
}

export function createStorageRef(params: {
  provider: StorageProvider
  bucket: string
  key: string
}): StorageObjectRef {
  return {
    provider: params.provider,
    bucket: assertStorageBucket(params.bucket),
    key: normalizeObjectKey(params.key),
  }
}

export function photoObjectKey(params: {
  ownerId: string
  albumId: string
  objectId: string
  kind: PhotoObjectKind
  extension?: string
}) {
  const ownerId = assertUuid(params.ownerId, 'ownerId')
  const albumId = assertUuid(params.albumId, 'albumId')
  const objectId = assertUuid(params.objectId, 'objectId')
  const extension = assertSafeExtension(params.extension || 'jpg')

  return `${ownerId}/${albumId}/${params.kind}/${objectId}.${extension}`
}

export function albumCoverKey(params: {
  ownerId: string
  albumId: string
  objectId: string
  extension?: string
}) {
  return photoObjectKey({
    ...params,
    kind: 'preview',
  }).replace('/preview/', '/cover/')
}

export function portfolioImageKey(params: {
  ownerId: string
  objectId: string
  extension?: string
}) {
  const ownerId = assertUuid(params.ownerId, 'ownerId')
  const objectId = assertUuid(params.objectId, 'objectId')
  const extension = assertSafeExtension(params.extension || 'jpg')

  return `${ownerId}/portfolio/${objectId}.${extension}`
}

export function guestMomentImageKey(params: {
  ownerId: string
  albumId: string
  objectId: string
  extension?: string
}) {
  const ownerId = assertUuid(params.ownerId, 'ownerId')
  const albumId = assertUuid(params.albumId, 'albumId')
  const objectId = assertUuid(params.objectId, 'objectId')
  const extension = assertSafeExtension(params.extension || 'jpg')

  return `${ownerId}/${albumId}/guest-moments/${objectId}.${extension}`
}

export function presetObjectKey(params: {
  ownerId: string
  objectId: string
  albumId?: string | null
}) {
  const ownerId = assertUuid(params.ownerId, 'ownerId')
  const objectId = assertUuid(params.objectId, 'objectId')
  const prefix = params.albumId
    ? `${ownerId}/${assertUuid(params.albumId, 'albumId')}`
    : ownerId

  return `${prefix}/presets/${objectId}.xmp`
}

export function isOwnedPortfolioObjectKey(value: string, ownerId: string) {
  let key: string

  try {
    key = normalizeObjectKey(value)
  } catch {
    return false
  }

  return key.toLowerCase().startsWith(`${ownerId.toLowerCase()}/portfolio/`)
}

export function isOwnedGuestMomentObjectKey(
  value: string,
  ownerId: string,
  albumId: string
) {
  let key: string

  try {
    key = normalizeObjectKey(value)
  } catch {
    return false
  }

  return key
    .toLowerCase()
    .startsWith(
      `${ownerId.toLowerCase()}/${albumId.toLowerCase()}/guest-moments/`
    )
}

export function isOwnedPresetObjectKey(
  value: string,
  ownerId: string,
  albumId?: string | null
) {
  let key: string

  try {
    key = normalizeObjectKey(value)
  } catch {
    return false
  }

  const lowerKey = key.toLowerCase()
  const ownerPrefix = `${ownerId.toLowerCase()}/presets/`

  if (lowerKey.startsWith(ownerPrefix)) return true
  if (!albumId) return false

  return lowerKey.startsWith(
    `${ownerId.toLowerCase()}/${albumId.toLowerCase()}/presets/`
  )
}

export function generatedDownloadKey(params: {
  ownerId: string
  albumId: string
  objectId: string
  extension?: string
}) {
  const ownerId = assertUuid(params.ownerId, 'ownerId')
  const albumId = assertUuid(params.albumId, 'albumId')
  const objectId = assertUuid(params.objectId, 'objectId')
  const extension = assertSafeExtension(params.extension || 'zip')

  return `${ownerId}/${albumId}/generated-downloads/${objectId}.${extension}`
}

export function isOwnedAlbumObjectKey(
  value: string,
  ownerId: string,
  albumId: string,
  allowedFolders: readonly string[] = PHOTO_OBJECT_KINDS
) {
  let key: string

  try {
    key = normalizeObjectKey(value)
  } catch {
    return false
  }

  const prefix = `${ownerId.toLowerCase()}/${albumId.toLowerCase()}/`

  if (!key.toLowerCase().startsWith(prefix)) return false

  const folder = key.slice(prefix.length).split('/')[0]

  return allowedFolders.includes(folder)
}

export function assertOwnedAlbumObjectKey(
  value: string,
  ownerId: string,
  albumId: string,
  allowedFolders?: readonly string[]
) {
  if (!isOwnedAlbumObjectKey(value, ownerId, albumId, allowedFolders)) {
    throw new Error('Storage object does not belong to the album owner')
  }

  return normalizeObjectKey(value)
}

export function isValidFaceSourceObjectKey(
  value: string,
  ownerId: string,
  albumId: string
) {
  return isOwnedAlbumObjectKey(
    value,
    ownerId,
    albumId,
    FACE_SOURCE_OBJECT_KINDS
  )
}

export function isPublicDeliveryKey(value: string) {
  let key: string

  try {
    key = normalizeObjectKey(value)
  } catch {
    return false
  }

  const parts = key.split('/')

  if (parts.length >= 3 && parts[1] === 'portfolio') return true

  const folder = parts[2]

  return (
    folder === 'preview' ||
    folder === 'thumbnail' ||
    folder === 'cover' ||
    folder === 'guest-moments'
  )
}

export function encodeObjectKey(value: string) {
  return normalizeObjectKey(value)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}
