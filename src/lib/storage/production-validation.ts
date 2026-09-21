import {
  inspectPhotoStorageMigration,
  planPhotoStorageMigration,
  type PhotoMigrationObjectPlan,
  type PhotoStorageMigrationRow,
} from './migration'
import { isPublicDeliveryKey } from './paths'
import type { StorageAdapter, StorageObjectHead } from './types'

export type ProductionValidationStatus = 'pass' | 'warning' | 'fail'

export type ProductionValidationCheck = {
  id: string
  status: ProductionValidationStatus
  message: string
  details?: Record<string, unknown>
}

export type ProductionValidationSummary = {
  passed: number
  warnings: number
  failed: number
  ready: boolean
}

export type ProductionEnvironmentInput = {
  supabaseUrl?: string | null
  hasSupabaseServiceRole: boolean
  r2AccountId?: string | null
  r2AccessKeyId?: string | null
  r2SecretAccessKey?: string | null
  r2BucketName?: string | null
  r2Endpoint?: string | null
  r2PublicBaseUrl?: string | null
  storageDefaultProvider?: string | null
  r2UploadsEnabled?: string | null
  r2UploadCanaryOwnerIds?: string | null
  migrationApplyEnabled?: string | null
  cleanupDryRun?: string | null
  storageCleanupDryRun?: string | null
  allowR2Delete?: string | null
  expectedRollout: 'disabled' | 'enabled'
}

export type ProductionCanaryPhoto = PhotoStorageMigrationRow & {
  migration_attempts?: number | string | null
  migration_error?: string | null
  migration_started_at?: string | null
  migration_completed_at?: string | null
  processing_status?: string | null
  preview_url?: string | null
  thumbnail_url?: string | null
  public_url?: string | null
  image_url?: string | null
  original_url?: string | null
  sd_url?: string | null
  hd_url?: string | null
  uhd_url?: string | null
}

function clean(value?: string | null) {
  return value?.trim() || null
}

function isTrue(value?: string | null) {
  return clean(value)?.toLowerCase() === 'true'
}

function absoluteHttpsUrl(value?: string | null) {
  const raw = clean(value)
  if (!raw) return null

  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function present(values: Array<string | null | undefined>) {
  return values.every((value) => Boolean(clean(value)))
}

function add(
  checks: ProductionValidationCheck[],
  id: string,
  status: ProductionValidationStatus,
  message: string,
  details?: Record<string, unknown>
) {
  checks.push({ id, status, message, ...(details ? { details } : {}) })
}

export function summarizeProductionValidation(
  checks: ProductionValidationCheck[]
): ProductionValidationSummary {
  const passed = checks.filter((check) => check.status === 'pass').length
  const warnings = checks.filter((check) => check.status === 'warning').length
  const failed = checks.filter((check) => check.status === 'fail').length

  return {
    passed,
    warnings,
    failed,
    ready: failed === 0,
  }
}

export function validateProductionEnvironment(
  input: ProductionEnvironmentInput
): ProductionValidationCheck[] {
  const checks: ProductionValidationCheck[] = []
  const supabaseUrl = absoluteHttpsUrl(input.supabaseUrl)
  const r2Endpoint = absoluteHttpsUrl(input.r2Endpoint)
  const publicBase = absoluteHttpsUrl(input.r2PublicBaseUrl)

  add(
    checks,
    'environment.supabase',
    supabaseUrl && input.hasSupabaseServiceRole ? 'pass' : 'fail',
    supabaseUrl && input.hasSupabaseServiceRole
      ? 'Supabase production URL and server credential are configured.'
      : 'Supabase production URL or server credential is missing/invalid.'
  )

  const hasR2Credentials = present([
    input.r2AccountId,
    input.r2AccessKeyId,
    input.r2SecretAccessKey,
    input.r2BucketName,
  ])
  add(
    checks,
    'environment.r2',
    hasR2Credentials && r2Endpoint ? 'pass' : 'fail',
    hasR2Credentials && r2Endpoint
      ? 'R2 server configuration is complete.'
      : 'R2 server configuration is incomplete or its endpoint is not HTTPS.'
  )

  const rawR2Hostname = r2Endpoint?.hostname.toLowerCase() || ''
  const publicHostname = publicBase?.hostname.toLowerCase() || ''
  const publicUsesRawR2Endpoint =
    Boolean(publicHostname) &&
    (publicHostname === rawR2Hostname ||
      publicHostname.endsWith('.r2.cloudflarestorage.com'))

  add(
    checks,
    'environment.public-delivery',
    publicBase && !publicUsesRawR2Endpoint ? 'pass' : 'fail',
    publicBase && !publicUsesRawR2Endpoint
      ? 'R2 public delivery uses a separate HTTPS CDN/gateway URL.'
      : 'R2_PUBLIC_BASE_URL must be an HTTPS CDN/gateway, not the raw R2 S3 endpoint.'
  )

  const rolloutEnabled =
    clean(input.storageDefaultProvider) === 'r2' &&
    isTrue(input.r2UploadsEnabled)
  const rolloutMatches =
    input.expectedRollout === 'enabled' ? rolloutEnabled : !rolloutEnabled

  add(
    checks,
    'rollout.upload-gate',
    rolloutMatches ? 'pass' : 'fail',
    rolloutMatches
      ? `R2 upload rollout is ${input.expectedRollout} as expected.`
      : `R2 upload rollout does not match expected state: ${input.expectedRollout}.`,
    {
      storageDefaultProvider: clean(input.storageDefaultProvider) || 'supabase',
      r2UploadsEnabled: isTrue(input.r2UploadsEnabled),
    }
  )

  const rawCanaryOwnerIds = clean(input.r2UploadCanaryOwnerIds)
  const canaryOwnerIds = rawCanaryOwnerIds
    ? rawCanaryOwnerIds.split(',').map((value) => value.trim())
    : []
  const validCanaryOwnerIds = canaryOwnerIds.every(
    (value) =>
      Boolean(value) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
  )
  const canaryStatus: ProductionValidationStatus = !validCanaryOwnerIds
    ? 'fail'
    : input.expectedRollout === 'enabled' && canaryOwnerIds.length === 0
      ? 'warning'
      : 'pass'

  add(
    checks,
    'rollout.owner-canary',
    canaryStatus,
    !validCanaryOwnerIds
      ? 'R2_UPLOAD_CANARY_OWNER_IDS contains an invalid UUID.'
      : input.expectedRollout === 'enabled' && canaryOwnerIds.length === 0
        ? 'R2 uploads are enabled without an owner allowlist; this is a full rollout, not a bounded canary.'
        : canaryOwnerIds.length > 0
          ? `R2 writes are bounded to ${canaryOwnerIds.length} canary owner(s).`
          : 'R2 upload rollout is disabled; no owner can write to R2.',
    { canaryOwners: canaryOwnerIds.length }
  )

  add(
    checks,
    'rollout.migration-write-gate',
    isTrue(input.migrationApplyEnabled) ? 'warning' : 'pass',
    isTrue(input.migrationApplyEnabled)
      ? 'Migration apply gate is still enabled; disable it immediately after the bounded canary command.'
      : 'Migration apply gate is disabled.'
  )

  const cleanupIsDryRun =
    clean(input.cleanupDryRun)?.toLowerCase() !== 'false' &&
    clean(input.storageCleanupDryRun)?.toLowerCase() !== 'false'
  const destructiveR2CleanupDisabled = !isTrue(input.allowR2Delete)

  add(
    checks,
    'rollout.cleanup-gates',
    cleanupIsDryRun && destructiveR2CleanupDisabled ? 'pass' : 'fail',
    cleanupIsDryRun && destructiveR2CleanupDisabled
      ? 'Storage cleanup remains dry-run and R2 deletion is disabled.'
      : 'Destructive storage cleanup must remain disabled throughout Phase 14.'
  )

  return checks
}

function hasDirectPrivateUrl(photo: ProductionCanaryPhoto) {
  return [photo.original_url, photo.sd_url, photo.hd_url, photo.uhd_url].some(
    (value) => Boolean(clean(value))
  )
}

export async function validateProductionCanary(params: {
  photo: ProductionCanaryPhoto
  targetBucket: string
  sourceAdapter: StorageAdapter
  targetAdapter: StorageAdapter
}): Promise<ProductionValidationCheck[]> {
  const checks: ProductionValidationCheck[] = []
  const photo = params.photo

  const rowReady =
    photo.storage_provider === 'r2' &&
    photo.storage_bucket === params.targetBucket &&
    photo.migration_status === 'completed' &&
    !photo.migration_error

  add(
    checks,
    'canary.database-state',
    rowReady ? 'pass' : 'fail',
    rowReady
      ? 'Canary row is completed on the configured R2 bucket.'
      : 'Canary row has not completed the R2 provider switch safely.',
    {
      provider: photo.storage_provider || null,
      bucket: photo.storage_bucket || null,
      migrationStatus: photo.migration_status || null,
    }
  )

  add(
    checks,
    'canary.processing-state',
    ['completed', 'done', 'ready'].includes(String(photo.processing_status || ''))
      ? 'pass'
      : 'warning',
    ['completed', 'done', 'ready'].includes(String(photo.processing_status || ''))
      ? 'Canary photo processing is complete.'
      : `Canary photo processing state is ${photo.processing_status || 'unknown'}.`
  )

  add(
    checks,
    'canary.private-urls',
    hasDirectPrivateUrl(photo) ? 'fail' : 'pass',
    hasDirectPrivateUrl(photo)
      ? 'A private Original/SD/HD/UHD URL is stored directly on the R2 row.'
      : 'Private download URL fields are not exposed on the R2 row.'
  )

  try {
    const requiresSourceRetention =
      Number(photo.migration_attempts || 0) > 0 ||
      Boolean(photo.migration_started_at)
    let verifiedObjects: Array<{
      plan: PhotoMigrationObjectPlan
      targetHead: StorageObjectHead
    }>

    if (requiresSourceRetention) {
      const inspection = await inspectPhotoStorageMigration({
        photo: { ...photo, storage_provider: 'supabase' },
        targetBucket: params.targetBucket,
        sourceAdapter: params.sourceAdapter,
        targetAdapter: params.targetAdapter,
      })
      verifiedObjects = inspection.map((item) => ({
        plan: item.plan,
        targetHead: item.targetHead,
      }))
      add(
        checks,
        'canary.supabase-source-retention',
        'pass',
        'Migrated canary objects are still retained in Supabase.'
      )
    } else {
      const plans = planPhotoStorageMigration(
        { ...photo, storage_provider: 'supabase' },
        params.targetBucket
      )
      verifiedObjects = []

      for (const plan of plans) {
        const targetHead = await params.targetAdapter.objectExists(plan.target)
        const actualSize = Number(targetHead.sizeBytes)

        if (!targetHead.exists || !Number.isSafeInteger(actualSize) || actualSize < 1) {
          throw new Error(`R2-native canary object is missing: ${plan.key}`)
        }
        if (
          plan.expectedSizeBytes !== null &&
          actualSize !== plan.expectedSizeBytes
        ) {
          throw new Error(
            `R2-native canary size mismatch for ${plan.key}: expected ${plan.expectedSizeBytes}, got ${actualSize}`
          )
        }
        verifiedObjects.push({ plan, targetHead })
      }

      add(
        checks,
        'canary.supabase-source-retention',
        'pass',
        'R2-native upload does not require a legacy Supabase source object.'
      )
    }

    const missingTarget = verifiedObjects.filter(
      (item) => !item.targetHead.exists
    )
    const copiedBytes = verifiedObjects.reduce(
      (total, item) => total + Number(item.targetHead.sizeBytes || 0),
      0
    )

    add(
      checks,
      'canary.object-parity',
      missingTarget.length === 0 ? 'pass' : 'fail',
      missingTarget.length === 0
        ? requiresSourceRetention
          ? 'Every referenced object exists in Supabase and R2 with matching size.'
          : 'Every referenced R2-native object exists with the expected size.'
        : 'One or more referenced R2 objects are missing.',
      { objects: verifiedObjects.length, bytes: copiedBytes }
    )

    const publicObjects = verifiedObjects.filter((item) =>
      isPublicDeliveryKey(item.plan.key)
    )
    const publicUrls = publicObjects.map((item) =>
      params.targetAdapter.getPublicUrl(item.plan.target)
    )
    add(
      checks,
      'canary.public-urls',
      publicObjects.length > 0 && publicUrls.every(Boolean) ? 'pass' : 'fail',
      publicObjects.length > 0 && publicUrls.every(Boolean)
        ? 'Public preview/thumbnail URLs resolve through the R2 delivery adapter.'
        : 'Canary has no valid public R2 preview/thumbnail delivery URL.',
      { publicObjects: publicObjects.length }
    )

    const expectedPreview = verifiedObjects
      .filter((item) => item.plan.fields.includes('preview_path'))
      .map((item) => params.targetAdapter.getPublicUrl(item.plan.target))[0]
    const expectedThumbnail = verifiedObjects
      .filter((item) => item.plan.fields.includes('thumbnail_path'))
      .map((item) => params.targetAdapter.getPublicUrl(item.plan.target))[0]
    const expectedPrimary = expectedPreview || expectedThumbnail || null
    const deliveryMetadataMatches =
      (expectedPreview ? photo.preview_url === expectedPreview : true) &&
      (expectedThumbnail ? photo.thumbnail_url === expectedThumbnail : true) &&
      photo.public_url === expectedPrimary &&
      photo.image_url === expectedPrimary

    add(
      checks,
      'canary.database-delivery-urls',
      deliveryMetadataMatches ? 'pass' : 'fail',
      deliveryMetadataMatches
        ? 'Stored public delivery URLs match the current R2 CDN/gateway.'
        : 'Stored public delivery URLs do not match the current R2 CDN/gateway.'
    )

    const original = verifiedObjects.find((item) =>
      item.plan.key.includes('/original/')
    )
    if (!original) {
      add(
        checks,
        'canary.private-download-signing',
        'fail',
        'Canary has no original object to validate private download signing.'
      )
    } else {
      const signedUrl = await params.targetAdapter.getSignedDownloadUrl(
        original.plan.target,
        { expiresInSeconds: 60, downloadName: 'ciiya-canary.jpg' }
      )
      const signed = absoluteHttpsUrl(signedUrl)
      add(
        checks,
        'canary.private-download-signing',
        signed ? 'pass' : 'fail',
        signed
          ? 'Private original can produce a short-lived HTTPS signed URL.'
          : 'Private original download signing returned an invalid URL.'
      )
    }
  } catch (error) {
    add(
      checks,
      'canary.object-parity',
      'fail',
      error instanceof Error ? error.message : 'Canary object verification failed.'
    )
  }

  return checks
}
