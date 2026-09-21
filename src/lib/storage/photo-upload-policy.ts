import { createHash } from 'node:crypto'

export const MAX_DIRECT_PHOTO_UPLOAD_BYTES = 200 * 1024 * 1024
export const SIGNED_PHOTO_UPLOAD_EXPIRES_SECONDS = 10 * 60
export const PHOTO_UPLOAD_SESSION_EXPIRES_SECONDS = 15 * 60

const MIME_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type DirectPhotoMimeType = keyof typeof MIME_EXTENSION

export function normalizeDirectPhotoMimeType(value: unknown) {
  const mimeType = String(value || '')
    .trim()
    .toLowerCase()

  return mimeType in MIME_EXTENSION
    ? (mimeType as DirectPhotoMimeType)
    : null
}

export function getDirectPhotoExtension(mimeType: DirectPhotoMimeType) {
  return MIME_EXTENSION[mimeType]
}

export function hasMatchingPhotoExtension(
  fileName: string,
  mimeType: DirectPhotoMimeType
) {
  const normalizedName = fileName.trim().toLowerCase()

  if (mimeType === 'image/jpeg') {
    return normalizedName.endsWith('.jpg') || normalizedName.endsWith('.jpeg')
  }

  return normalizedName.endsWith(`.${MIME_EXTENSION[mimeType]}`)
}

export function normalizeRequestedPhotoSize(value: unknown) {
  const size = String(value || '')
    .trim()
    .toLowerCase()

  if (size === 'sd' || size === 'hd' || size === 'uhd') return size
  return 'original'
}

export function normalizePhotoFileHash(params: {
  providedHash?: unknown
  fileName: string
  fileSizeBytes: number
  lastModified?: unknown
}) {
  const providedHash = String(params.providedHash || '').trim()

  if (providedHash.length > 500) {
    throw new Error('Invalid file hash')
  }

  if (/^[a-f0-9]{64}$/i.test(providedHash)) {
    return providedHash.toLowerCase()
  }

  const source =
    providedHash ||
    `${params.fileName}-${params.fileSizeBytes}-${String(
      params.lastModified || ''
    )}`

  return createHash('sha256').update(source, 'utf8').digest('hex')
}

export function estimatePhotoStorageBytes(fileSizeBytes: number) {
  if (
    !Number.isSafeInteger(fileSizeBytes) ||
    fileSizeBytes < 1 ||
    fileSizeBytes > MAX_DIRECT_PHOTO_UPLOAD_BYTES
  ) {
    throw new Error('Invalid upload size')
  }

  const total =
    fileSizeBytes +
    Math.round(fileSizeBytes * 0.35) +
    Math.round(fileSizeBytes * 0.05)

  if (!Number.isSafeInteger(total)) {
    throw new Error('Storage calculation exceeds safe integer range')
  }

  return total
}

export function hasUnsafeUploadPath(value: string) {
  const lowerValue = value.toLowerCase()

  return (
    value.includes('..') ||
    value.includes('\\') ||
    value.includes('//') ||
    lowerValue.includes('%2e') ||
    lowerValue.includes('%2f') ||
    lowerValue.includes('%5c')
  )
}
