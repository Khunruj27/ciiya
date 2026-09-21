import type { StorageProvider } from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  endpoint: string
  publicBaseUrl: string | null
}

const R2_REQUIRED_ENV = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT',
] as const

function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim()
  return value || null
}

function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '')
}

function assertHttpUrl(value: string, name: string) {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid ${name}: expected an absolute URL`)
  }

  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error(`Invalid ${name}: HTTPS is required`)
  }

  return stripTrailingSlashes(url.toString())
}

export function getDefaultStorageProvider(): StorageProvider {
  const provider = readOptionalEnv('STORAGE_DEFAULT_PROVIDER') || 'supabase'

  if (provider !== 'supabase' && provider !== 'r2') {
    throw new Error(
      'Invalid STORAGE_DEFAULT_PROVIDER: expected "supabase" or "r2"'
    )
  }

  return provider
}

export function hasCompleteR2Config() {
  return R2_REQUIRED_ENV.every((name) => Boolean(readOptionalEnv(name)))
}

export function isR2PhotoUploadEnabled() {
  return (
    getDefaultStorageProvider() === 'r2' &&
    readOptionalEnv('R2_UPLOADS_ENABLED')?.toLowerCase() === 'true' &&
    hasCompleteR2Config()
  )
}

export function getR2UploadCanaryOwnerIds() {
  const value = readOptionalEnv('R2_UPLOAD_CANARY_OWNER_IDS')
  if (!value) return []

  const ownerIds = [
    ...new Set(value.split(',').map((item) => item.trim().toLowerCase())),
  ]

  if (ownerIds.some((ownerId) => !UUID_PATTERN.test(ownerId))) {
    throw new Error(
      'Invalid R2_UPLOAD_CANARY_OWNER_IDS: expected comma-separated UUIDs'
    )
  }

  return ownerIds
}

/**
 * During Phase 14, a non-empty owner allowlist keeps the R2 write rollout
 * bounded even while the global provider and upload gates are enabled. An
 * empty allowlist intentionally means full rollout after the canary ends.
 */
export function isR2PhotoUploadEnabledForOwner(ownerId: string) {
  if (!isR2PhotoUploadEnabled()) return false

  const canaryOwnerIds = getR2UploadCanaryOwnerIds()
  if (canaryOwnerIds.length === 0) return true

  return canaryOwnerIds.includes(ownerId.trim().toLowerCase())
}

/**
 * Public Portfolio and Guest Moment URLs must stay stable in database rows.
 * Keep those uploads on the existing Supabase public buckets until an R2
 * custom domain/CDN is configured, even if private photo uploads have already
 * moved to R2.
 */
export function isR2PublicAssetUploadEnabled() {
  if (!isR2PhotoUploadEnabled()) return false

  try {
    return Boolean(getR2Config().publicBaseUrl)
  } catch {
    return false
  }
}

export function isR2PublicAssetUploadEnabledForOwner(ownerId: string) {
  return isR2PhotoUploadEnabledForOwner(ownerId) && Boolean(getR2PublicBaseUrl())
}

/** Public delivery configuration is not a credential and can be resolved
 * independently from the S3 API keys. Read paths use this during a staged
 * migration so already-copied derivatives do not disappear merely because a
 * worker process does not need R2 write credentials. */
export function getR2PublicBaseUrl() {
  const value = readOptionalEnv('R2_PUBLIC_BASE_URL')
  return value ? assertHttpUrl(value, 'R2_PUBLIC_BASE_URL') : null
}

export function getR2Config(): R2Config {
  const missing = R2_REQUIRED_ENV.filter((name) => !readOptionalEnv(name))

  if (missing.length > 0) {
    throw new Error(`Missing R2 environment variables: ${missing.join(', ')}`)
  }

  const bucketName = readOptionalEnv('R2_BUCKET_NAME')!

  if (
    bucketName.includes('/') ||
    bucketName.includes('\\') ||
    bucketName.includes('..')
  ) {
    throw new Error('Invalid R2_BUCKET_NAME')
  }

  return {
    accountId: readOptionalEnv('R2_ACCOUNT_ID')!,
    accessKeyId: readOptionalEnv('R2_ACCESS_KEY_ID')!,
    secretAccessKey: readOptionalEnv('R2_SECRET_ACCESS_KEY')!,
    bucketName,
    endpoint: assertHttpUrl(readOptionalEnv('R2_ENDPOINT')!, 'R2_ENDPOINT'),
    publicBaseUrl: getR2PublicBaseUrl(),
  }
}
