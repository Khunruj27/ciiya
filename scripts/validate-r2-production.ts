import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  encodeObjectKey,
  getR2Config,
  getR2UploadCanaryOwnerIds,
  getStorageAdapter,
  planPhotoStorageMigration,
  summarizeProductionValidation,
  validateProductionCanary,
  validateProductionEnvironment,
  type ProductionCanaryPhoto,
  type ProductionValidationCheck,
} from '../src/lib/storage'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const PHOTO_SELECT = `
  id,
  owner_id,
  user_id,
  album_id,
  storage_provider,
  storage_bucket,
  storage_version,
  migration_status,
  migration_attempts,
  migration_error,
  migration_started_at,
  migration_completed_at,
  storage_path,
  original_path,
  preview_path,
  thumbnail_path,
  sd_path,
  hd_path,
  uhd_path,
  public_url,
  image_url,
  original_url,
  preview_url,
  thumbnail_url,
  sd_url,
  hd_url,
  uhd_url,
  file_size_bytes,
  original_size_bytes,
  preview_size_bytes,
  thumbnail_size_bytes,
  mime_type,
  processing_status,
  created_at,
  updated_at
`

type Options = {
  photoId: string | null
  expectedRollout: 'disabled' | 'enabled'
  strictWarnings: boolean
  skipPublicFetch: boolean
}

function optionValue(name: string) {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function parseOptions(): Options {
  const args = process.argv.slice(2)
  const knownFlags = new Set(['--strict-warnings', '--skip-public-fetch'])

  for (const arg of args) {
    if (
      knownFlags.has(arg) ||
      arg.startsWith('--photo-id=') ||
      arg.startsWith('--expect-rollout=')
    ) {
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  const photoId = optionValue('photo-id')?.trim() || null
  if (photoId && !UUID_PATTERN.test(photoId)) {
    throw new Error('--photo-id must be a UUID')
  }

  const expectedRollout = optionValue('expect-rollout')?.trim() || 'disabled'
  if (expectedRollout !== 'disabled' && expectedRollout !== 'enabled') {
    throw new Error('--expect-rollout must be disabled or enabled')
  }

  return {
    photoId,
    expectedRollout,
    strictWarnings: args.includes('--strict-warnings'),
    skipPublicFetch: args.includes('--skip-public-fetch'),
  }
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Missing Supabase production environment')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function check(
  id: string,
  status: ProductionValidationCheck['status'],
  message: string,
  details?: Record<string, unknown>
): ProductionValidationCheck {
  return { id, status, message, ...(details ? { details } : {}) }
}

async function exactCount(
  supabase: SupabaseClient,
  column: string,
  value: string
) {
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq(column, value)

  if (error) throw new Error(error.message)
  return count || 0
}

async function validateDatabase(
  supabase: SupabaseClient
): Promise<ProductionValidationCheck[]> {
  const checks: ProductionValidationCheck[] = []
  const schema = await supabase.from('photos').select(PHOTO_SELECT).limit(1)

  checks.push(
    check(
      'database.phase13-schema',
      schema.error ? 'fail' : 'pass',
      schema.error
        ? `Phase 13 photo schema is unavailable: ${schema.error.message}`
        : 'Phase 13 photo provider and migration fields are queryable.'
    )
  )

  const claimProbe = await supabase.rpc('claim_photo_storage_migrations', {
    p_limit: 0,
    p_include_failed: false,
    p_recover_stale: false,
    p_stale_after_seconds: 3600,
    p_photo_id: null,
  })
  const claimProbeMessage = claimProbe.error?.message || ''
  const claimFunctionExists = /p_limit must be between 1 and 50/i.test(
    claimProbeMessage
  )

  checks.push(
    check(
      'database.phase13-claim-rpc',
      claimFunctionExists ? 'pass' : 'fail',
      claimFunctionExists
        ? 'Phase 13 claim RPC exists; the zero-limit probe exited before claiming rows.'
        : `Phase 13 claim RPC probe failed unexpectedly: ${claimProbeMessage || 'no validation error returned'}`
    )
  )

  try {
    const [supabasePhotos, r2Photos, failed, copying, verifying] =
      await Promise.all([
        exactCount(supabase, 'storage_provider', 'supabase'),
        exactCount(supabase, 'storage_provider', 'r2'),
        exactCount(supabase, 'migration_status', 'failed'),
        exactCount(supabase, 'migration_status', 'copying'),
        exactCount(supabase, 'migration_status', 'verifying'),
      ])

    checks.push(
      check(
        'database.migration-inventory',
        failed === 0 && copying === 0 && verifying === 0 ? 'pass' : 'warning',
        failed === 0 && copying === 0 && verifying === 0
          ? 'No failed or in-flight storage migrations are present.'
          : 'Review failed or in-flight migrations before expanding the canary.',
        { supabasePhotos, r2Photos, failed, copying, verifying }
      )
    )
  } catch (error) {
    checks.push(
      check(
        'database.migration-inventory',
        'fail',
        error instanceof Error ? error.message : 'Unable to count migration rows.'
      )
    )
  }

  return checks
}

async function validateR2Inventory(
  targetAdapter: ReturnType<typeof getStorageAdapter>,
  bucket: string
) {
  if (!targetAdapter.listObjects) {
    return check(
      'r2.bucket-access',
      'fail',
      'R2 adapter does not expose the inventory capability required by consistency checks.'
    )
  }

  try {
    const result = await targetAdapter.listObjects({ bucket, limit: 1 })
    return check(
      'r2.bucket-access',
      'pass',
      'R2 bucket credentials can list the configured bucket.',
      { sampledObjects: result.objects.length }
    )
  } catch (error) {
    return check(
      'r2.bucket-access',
      'fail',
      error instanceof Error ? error.message : 'Unable to access the R2 bucket.'
    )
  }
}

async function fetchHead(url: string) {
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  return response.status
}

async function validatePublicDelivery(params: {
  photo: ProductionCanaryPhoto
  publicBaseUrl: string
  targetBucket: string
  targetAdapter: ReturnType<typeof getStorageAdapter>
}) {
  const checks: ProductionValidationCheck[] = []
  const plan = planPhotoStorageMigration(
    { ...params.photo, storage_provider: 'supabase' },
    params.targetBucket
  )

  // Keep selection explicit so only preview/thumbnail delivery is tested.
  const publicPlan = plan.find(
    (item) =>
      item.key.includes('/preview/') || item.key.includes('/thumbnail/')
  )
  const originalPlan = plan.find((item) => item.key.includes('/original/'))

  if (!publicPlan) {
    checks.push(
      check(
        'delivery.public-object',
        'fail',
        'Canary has no preview or thumbnail for public delivery validation.'
      )
    )
  } else {
    const publicUrl = params.targetAdapter.getPublicUrl(publicPlan.target)
    if (!publicUrl) {
      checks.push(
        check(
          'delivery.public-object',
          'fail',
          'R2 adapter did not produce a public canary URL.'
        )
      )
    } else {
      try {
        const status = await fetchHead(publicUrl)
        checks.push(
          check(
            'delivery.public-object',
            status >= 200 && status < 400 ? 'pass' : 'fail',
            status >= 200 && status < 400
              ? 'Public canary derivative is reachable through the CDN/gateway.'
              : `Public canary derivative returned HTTP ${status}.`,
            { status }
          )
        )
      } catch (error) {
        checks.push(
          check(
            'delivery.public-object',
            'fail',
            error instanceof Error
              ? `Public delivery request failed: ${error.message}`
              : 'Public delivery request failed.'
          )
        )
      }
    }
  }

  if (!originalPlan) {
    checks.push(
      check(
        'delivery.private-boundary',
        'fail',
        'Canary has no original object for private-delivery boundary validation.'
      )
    )
  } else {
    const privateProbeUrl = `${params.publicBaseUrl.replace(/\/+$/, '')}/${encodeObjectKey(originalPlan.key)}`
    try {
      const status = await fetchHead(privateProbeUrl)
      checks.push(
        check(
          'delivery.private-boundary',
          status >= 400 ? 'pass' : 'fail',
          status >= 400
            ? 'Public delivery gateway rejects the private original path.'
            : `Private original is publicly reachable (HTTP ${status}).`,
          { status }
        )
      )
    } catch (error) {
      checks.push(
        check(
          'delivery.private-boundary',
          'fail',
          error instanceof Error
            ? `Private-boundary request failed: ${error.message}`
            : 'Private-boundary request failed.'
        )
      )
    }
  }
  return checks
}

async function loadCanary(
  supabase: SupabaseClient,
  photoId: string
): Promise<ProductionCanaryPhoto> {
  const { data, error } = await supabase
    .from('photos')
    .select(PHOTO_SELECT)
    .eq('id', photoId)
    .maybeSingle()

  if (error) throw new Error(`Unable to load canary photo: ${error.message}`)
  if (!data) throw new Error('Canary photo was not found')
  return data as ProductionCanaryPhoto
}

async function validateCanaryDatabaseRelations(
  supabase: SupabaseClient,
  photo: ProductionCanaryPhoto
) {
  const checks: ProductionValidationCheck[] = []
  const ownerId = photo.owner_id || photo.user_id
  const { count: activeJobs, error: jobError } = await supabase
    .from('photo_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('photo_id', photo.id)
    .in('status', ['pending', 'processing'])

  checks.push(
    check(
      'canary.active-jobs',
      !jobError && (activeJobs || 0) === 0 ? 'pass' : 'fail',
      jobError
        ? `Unable to inspect canary jobs: ${jobError.message}`
        : (activeJobs || 0) === 0
          ? 'Canary has no active Photo Worker job.'
          : 'Canary still has an active Photo Worker job.',
      { activeJobs: activeJobs || 0 }
    )
  )

  if (!ownerId) {
    checks.push(
      check('canary.storage-quota', 'fail', 'Canary photo has no owner.')
    )
    return checks
  }

  const { data: usage, error: usageError } = await supabase
    .from('user_storage_usage')
    .select('used_bytes, storage_used_bytes, storage_limit_bytes, photo_count')
    .eq('user_id', ownerId)
    .maybeSingle()

  const quotaHealthy =
    !usageError &&
    Boolean(usage) &&
    Number(usage?.used_bytes || 0) >= 0 &&
    Number(usage?.storage_used_bytes || 0) >= 0 &&
    Number(usage?.storage_limit_bytes || 0) > 0

  checks.push(
    check(
      'canary.storage-quota',
      quotaHealthy ? 'pass' : 'fail',
      quotaHealthy
        ? 'Existing user_storage_usage remains available for the canary owner.'
        : `Canary storage quota record is invalid: ${usageError?.message || 'missing usage row'}`,
      usage
        ? {
            usedBytes: usage.used_bytes,
            storageUsedBytes: usage.storage_used_bytes,
            storageLimitBytes: usage.storage_limit_bytes,
            photoCount: usage.photo_count,
          }
        : undefined
    )
  )

  return checks
}

function printChecks(checks: ProductionValidationCheck[]) {
  for (const item of checks) {
    console.log(
      JSON.stringify({
        type: 'check',
        ...item,
      })
    )
  }
}

async function main() {
  const options = parseOptions()
  const checks = validateProductionEnvironment({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasSupabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    r2AccountId: process.env.R2_ACCOUNT_ID,
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    r2BucketName: process.env.R2_BUCKET_NAME,
    r2Endpoint: process.env.R2_ENDPOINT,
    r2PublicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
    storageDefaultProvider: process.env.STORAGE_DEFAULT_PROVIDER,
    r2UploadsEnabled: process.env.R2_UPLOADS_ENABLED,
    r2UploadCanaryOwnerIds: process.env.R2_UPLOAD_CANARY_OWNER_IDS,
    migrationApplyEnabled: process.env.STORAGE_MIGRATION_APPLY_ENABLED,
    cleanupDryRun: process.env.CLEANUP_DRY_RUN,
    storageCleanupDryRun: process.env.STORAGE_CLEANUP_DRY_RUN,
    allowR2Delete: process.env.STORAGE_CLEANUP_ALLOW_R2_DELETE,
    expectedRollout: options.expectedRollout,
  })

  const supabase = getSupabaseAdmin()
  const r2Config = getR2Config()
  const sourceAdapter = getStorageAdapter('supabase', { supabase })
  const targetAdapter = getStorageAdapter('r2')

  checks.push(...(await validateDatabase(supabase)))
  checks.push(await validateR2Inventory(targetAdapter, r2Config.bucketName))

  if (options.photoId) {
    try {
      const photo = await loadCanary(supabase, options.photoId)
      if (options.expectedRollout === 'enabled') {
        const ownerId = photo.owner_id || photo.user_id || ''
        const canaryOwnerIds = getR2UploadCanaryOwnerIds()
        checks.push(
          check(
            'canary.owner-rollout',
            ownerId && canaryOwnerIds.includes(ownerId.toLowerCase())
              ? 'pass'
              : 'fail',
            ownerId && canaryOwnerIds.includes(ownerId.toLowerCase())
              ? 'Selected photo belongs to an allowlisted R2 canary owner.'
              : 'Selected photo owner is not present in R2_UPLOAD_CANARY_OWNER_IDS.'
          )
        )
      }
      checks.push(
        ...(await validateProductionCanary({
          photo,
          targetBucket: r2Config.bucketName,
          sourceAdapter,
          targetAdapter,
        }))
      )
      checks.push(...(await validateCanaryDatabaseRelations(supabase, photo)))

      if (options.skipPublicFetch) {
        checks.push(
          check(
            'delivery.network-probes',
            'warning',
            'Public and private delivery network probes were explicitly skipped.'
          )
        )
      } else if (r2Config.publicBaseUrl) {
        checks.push(
          ...(await validatePublicDelivery({
            photo,
            publicBaseUrl: r2Config.publicBaseUrl,
            targetBucket: r2Config.bucketName,
            targetAdapter,
          }))
        )
      }
    } catch (error) {
      checks.push(
        check(
          'canary.validation',
          'fail',
          error instanceof Error ? error.message : 'Canary validation failed.'
        )
      )
    }
  } else {
    checks.push(
      check(
        'canary.selection',
        'warning',
        'Preflight only: provide --photo-id=<uuid> after the one-photo canary migration.'
      )
    )
  }

  printChecks(checks)
  const summary = summarizeProductionValidation(checks)
  console.log(
    JSON.stringify({
      type: 'summary',
      mode: options.photoId ? 'canary' : 'preflight',
      expectedRollout: options.expectedRollout,
      destructiveActions: false,
      ...summary,
    })
  )

  if (!summary.ready || (options.strictWarnings && summary.warnings > 0)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      type: 'fatal',
      destructiveActions: false,
      message: error instanceof Error ? error.message : String(error),
    })
  )
  process.exitCode = 1
})
