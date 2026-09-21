import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  summarizeProductionValidation,
  validateProductionCanary,
  validateProductionEnvironment,
  type ProductionCanaryPhoto,
} from '../src/lib/storage/production-validation'
import { isR2PhotoUploadEnabledForOwner } from '../src/lib/storage/config'
import type {
  StorageAdapter,
  StorageObjectHead,
  StorageObjectRef,
} from '../src/lib/storage/types'

function identity(ref: StorageObjectRef) {
  return `${ref.provider}:${ref.bucket}:${ref.key}`
}

function head(sizeBytes: number): StorageObjectHead {
  return {
    exists: true,
    sizeBytes,
    contentType: 'image/jpeg',
    etag: `etag-${sizeBytes}`,
    lastModified: new Date('2026-09-21T00:00:00.000Z'),
  }
}

function missing(): StorageObjectHead {
  return {
    exists: false,
    sizeBytes: null,
    contentType: null,
    etag: null,
    lastModified: null,
  }
}

function fakeAdapter(params: {
  provider: 'supabase' | 'r2'
  objects: Map<string, number>
}) {
  return {
    provider: params.provider,
    async objectExists(ref: StorageObjectRef) {
      const size = params.objects.get(identity(ref))
      return size === undefined ? missing() : head(size)
    },
    getPublicUrl(ref: StorageObjectRef) {
      return ref.key.includes('/preview/') || ref.key.includes('/thumbnail/')
        ? `https://media.example.com/${ref.key}`
        : null
    },
    async getSignedDownloadUrl() {
      return 'https://account.r2.cloudflarestorage.com/ciiya/signed?X-Amz-Signature=test'
    },
  } as unknown as StorageAdapter
}

async function main() {
  const safeEnvironment = validateProductionEnvironment({
    supabaseUrl: 'https://project.supabase.co',
    hasSupabaseServiceRole: true,
    r2AccountId: 'account',
    r2AccessKeyId: 'access',
    r2SecretAccessKey: 'secret',
    r2BucketName: 'ciiya-media',
    r2Endpoint: 'https://account.r2.cloudflarestorage.com',
    r2PublicBaseUrl: 'https://media.example.com',
    storageDefaultProvider: 'supabase',
    r2UploadsEnabled: 'false',
    r2UploadCanaryOwnerIds: '',
    migrationApplyEnabled: 'false',
    cleanupDryRun: 'true',
    storageCleanupDryRun: 'true',
    allowR2Delete: 'false',
    expectedRollout: 'disabled',
  })
  assert.equal(summarizeProductionValidation(safeEnvironment).ready, true)
  assert.equal(
    safeEnvironment.every((item) => item.status === 'pass'),
    true
  )

  const unsafePublicEndpoint = validateProductionEnvironment({
    supabaseUrl: 'https://project.supabase.co',
    hasSupabaseServiceRole: true,
    r2AccountId: 'account',
    r2AccessKeyId: 'access',
    r2SecretAccessKey: 'secret',
    r2BucketName: 'ciiya-media',
    r2Endpoint: 'https://account.r2.cloudflarestorage.com',
    r2PublicBaseUrl: 'https://account.r2.cloudflarestorage.com',
    storageDefaultProvider: 'r2',
    r2UploadsEnabled: 'true',
    r2UploadCanaryOwnerIds: '',
    migrationApplyEnabled: 'true',
    cleanupDryRun: 'false',
    storageCleanupDryRun: 'false',
    allowR2Delete: 'true',
    expectedRollout: 'disabled',
  })
  assert.equal(
    unsafePublicEndpoint.some((item) => item.status === 'fail'),
    true
  )

  const boundedRollout = validateProductionEnvironment({
    supabaseUrl: 'https://project.supabase.co',
    hasSupabaseServiceRole: true,
    r2AccountId: 'account',
    r2AccessKeyId: 'access',
    r2SecretAccessKey: 'secret',
    r2BucketName: 'ciiya-media',
    r2Endpoint: 'https://account.r2.cloudflarestorage.com',
    r2PublicBaseUrl: 'https://media.example.com',
    storageDefaultProvider: 'r2',
    r2UploadsEnabled: 'true',
    r2UploadCanaryOwnerIds: '11111111-1111-4111-8111-111111111111',
    migrationApplyEnabled: 'false',
    cleanupDryRun: 'true',
    storageCleanupDryRun: 'true',
    allowR2Delete: 'false',
    expectedRollout: 'enabled',
  })
  assert.equal(
    boundedRollout.every((item) => item.status === 'pass'),
    true
  )

  const ownerId = '11111111-1111-4111-8111-111111111111'
  const otherOwnerId = '55555555-5555-4555-8555-555555555555'
  const originalEnvironment = { ...process.env }
  process.env.STORAGE_DEFAULT_PROVIDER = 'r2'
  process.env.R2_UPLOADS_ENABLED = 'true'
  process.env.R2_ACCOUNT_ID = 'account'
  process.env.R2_ACCESS_KEY_ID = 'access'
  process.env.R2_SECRET_ACCESS_KEY = 'secret'
  process.env.R2_BUCKET_NAME = 'ciiya-media'
  process.env.R2_ENDPOINT = 'https://account.r2.cloudflarestorage.com'
  process.env.R2_UPLOAD_CANARY_OWNER_IDS = ownerId
  assert.equal(isR2PhotoUploadEnabledForOwner(ownerId), true)
  assert.equal(isR2PhotoUploadEnabledForOwner(otherOwnerId), false)
  process.env = originalEnvironment

  const albumId = '22222222-2222-4222-8222-222222222222'
  const objectId = '33333333-3333-4333-8333-333333333333'
  const originalKey = `${ownerId}/${albumId}/original/${objectId}.jpg`
  const previewKey = `${ownerId}/${albumId}/preview/${objectId}.jpg`
  const thumbnailKey = `${ownerId}/${albumId}/thumbnail/${objectId}.jpg`
  const photo: ProductionCanaryPhoto = {
    id: '44444444-4444-4444-8444-444444444444',
    owner_id: ownerId,
    album_id: albumId,
    storage_provider: 'r2',
    storage_bucket: 'ciiya-media',
    storage_version: 1,
    migration_status: 'completed',
    migration_attempts: 1,
    migration_error: null,
    processing_status: 'done',
    original_path: originalKey,
    storage_path: previewKey,
    preview_path: previewKey,
    thumbnail_path: thumbnailKey,
    original_size_bytes: 4,
    preview_size_bytes: 3,
    thumbnail_size_bytes: 2,
    preview_url: `https://media.example.com/${previewKey}`,
    thumbnail_url: `https://media.example.com/${thumbnailKey}`,
    public_url: `https://media.example.com/${previewKey}`,
    image_url: `https://media.example.com/${previewKey}`,
    original_url: null,
    sd_url: null,
    hd_url: null,
    uhd_url: null,
  }
  const sourceObjects = new Map<string, number>([
    [`supabase:albums:${originalKey}`, 4],
    [`supabase:albums:${previewKey}`, 3],
    [`supabase:albums:${thumbnailKey}`, 2],
  ])
  const targetObjects = new Map<string, number>([
    [`r2:ciiya-media:${originalKey}`, 4],
    [`r2:ciiya-media:${previewKey}`, 3],
    [`r2:ciiya-media:${thumbnailKey}`, 2],
  ])
  const sourceAdapter = fakeAdapter({
    provider: 'supabase',
    objects: sourceObjects,
  })
  const targetAdapter = fakeAdapter({
    provider: 'r2',
    objects: targetObjects,
  })

  const canaryChecks = await validateProductionCanary({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter,
    targetAdapter,
  })
  assert.equal(summarizeProductionValidation(canaryChecks).ready, true)
  assert.equal(canaryChecks.every((item) => item.status === 'pass'), true)

  const r2NativeChecks = await validateProductionCanary({
    photo: {
      ...photo,
      migration_attempts: 0,
      migration_started_at: null,
      migration_completed_at: '2026-09-21T00:00:00.000Z',
    },
    targetBucket: 'ciiya-media',
    sourceAdapter: fakeAdapter({ provider: 'supabase', objects: new Map() }),
    targetAdapter,
  })
  assert.equal(summarizeProductionValidation(r2NativeChecks).ready, true)
  assert.equal(
    r2NativeChecks.find(
      (item) => item.id === 'canary.supabase-source-retention'
    )?.message,
    'R2-native upload does not require a legacy Supabase source object.'
  )

  const privateLeakChecks = await validateProductionCanary({
    photo: { ...photo, original_url: 'https://media.example.com/original.jpg' },
    targetBucket: 'ciiya-media',
    sourceAdapter,
    targetAdapter,
  })
  assert.equal(
    privateLeakChecks.find((item) => item.id === 'canary.private-urls')?.status,
    'fail'
  )

  const mismatchedTarget = new Map(targetObjects)
  mismatchedTarget.set(`r2:ciiya-media:${previewKey}`, 99)
  const parityChecks = await validateProductionCanary({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter,
    targetAdapter: fakeAdapter({ provider: 'r2', objects: mismatchedTarget }),
  })
  assert.equal(
    parityChecks.find((item) => item.id === 'canary.object-parity')?.status,
    'fail'
  )

  const missingSource = new Map(sourceObjects)
  missingSource.delete(`supabase:albums:${originalKey}`)
  const retentionChecks = await validateProductionCanary({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter: fakeAdapter({ provider: 'supabase', objects: missingSource }),
    targetAdapter,
  })
  assert.equal(
    retentionChecks.find((item) => item.id === 'canary.object-parity')?.status,
    'fail'
  )

  const cliSource = await readFile('scripts/validate-r2-production.ts', 'utf8')
  const uploadRoute = await readFile(
    'src/app/api/photos/upload-url/route.ts',
    'utf8'
  )
  const albumPage = await readFile('src/app/albums/[id]/page.tsx', 'utf8')
  const cameraWorker = await readFile(
    'workers/camera-live-import-worker.ts',
    'utf8'
  )
  const portfolioRoute = await readFile(
    'src/app/api/portfolio/assets/upload-url/route.ts',
    'utf8'
  )
  const guestMomentsRoute = await readFile(
    'src/app/api/share/moments/route.ts',
    'utf8'
  )
  assert.match(cliSource, /p_limit: 0/)
  assert.match(cliSource, /destructiveActions: false/)
  assert.doesNotMatch(cliSource, /\.update\(|\.insert\(|\.upsert\(/)
  assert.doesNotMatch(
    cliSource,
    /deleteObject\(|deleteObjects\(|uploadObject\(|\.remove\(/
  )
  assert.match(uploadRoute, /isR2PhotoUploadEnabledForOwner\(user\.id\)/)
  assert.match(albumPage, /isR2PhotoUploadEnabledForOwner\(user\.id\)/)
  assert.match(
    cameraWorker,
    /isR2PhotoUploadEnabledForOwner\(session\.owner_id\)/
  )
  assert.match(portfolioRoute, /getStorageAssetTarget\('portfolio', user\.id\)/)
  assert.match(
    guestMomentsRoute,
    /getStorageAssetTarget\('guest_moment', ownerId\)/
  )

  console.log('Phase 14 production validation checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
