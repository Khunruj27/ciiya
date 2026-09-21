import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  deleteVerifiedPhotoSources,
  inspectPhotoSourceCleanup,
  type PhotoSourceCleanupRow,
} from '../src/lib/storage/source-cleanup'
import type {
  DeleteObjectsResult,
  StorageAdapter,
  StorageObjectHead,
  StorageObjectRef,
} from '../src/lib/storage/types'

function identity(ref: StorageObjectRef) {
  return `${ref.provider}:${ref.bucket}:${ref.key}`
}

function present(sizeBytes: number): StorageObjectHead {
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
  deleted?: StorageObjectRef[]
  failDeleteOnce?: Set<string>
  deleteCalls?: StorageObjectRef[][]
}) {
  return {
    provider: params.provider,
    async objectExists(ref: StorageObjectRef) {
      const size = params.objects.get(identity(ref))
      return size === undefined ? missing() : present(size)
    },
    async deleteObjects(refs: StorageObjectRef[]): Promise<DeleteObjectsResult> {
      params.deleteCalls?.push(refs)
      const deleted: StorageObjectRef[] = []
      const failed: DeleteObjectsResult['failed'] = []

      for (const ref of refs) {
        const key = identity(ref)
        if (params.failDeleteOnce?.delete(key)) {
          failed.push({ ref, error: 'Injected transient failure' })
          continue
        }
        params.objects.delete(key)
        params.deleted?.push(ref)
        deleted.push(ref)
      }

      return { deleted, failed }
    },
  } as StorageAdapter
}

async function main() {
  const ownerId = '11111111-1111-4111-8111-111111111111'
  const albumId = '22222222-2222-4222-8222-222222222222'
  const objectId = '33333333-3333-4333-8333-333333333333'
  const originalKey = `${ownerId}/${albumId}/original/${objectId}.jpg`
  const previewKey = `${ownerId}/${albumId}/preview/${objectId}.jpg`
  const thumbnailKey = `${ownerId}/${albumId}/thumbnail/${objectId}.jpg`
  const photo: PhotoSourceCleanupRow = {
    id: '44444444-4444-4444-8444-444444444444',
    owner_id: ownerId,
    album_id: albumId,
    storage_provider: 'r2',
    storage_bucket: 'ciiya-media',
    storage_version: 1,
    migration_status: 'completed',
    migration_attempts: 1,
    migration_completed_at: '2026-08-01T00:00:00.000Z',
    source_cleanup_status: 'retained',
    storage_path: previewKey,
    original_path: originalKey,
    preview_path: previewKey,
    thumbnail_path: thumbnailKey,
    original_size_bytes: 4,
    preview_size_bytes: 3,
    thumbnail_size_bytes: 2,
    mime_type: 'image/jpeg',
  }

  const sourceObjects = new Map<string, number>([
    // Legacy original fallback deliberately lives in albums.
    [`supabase:albums:${originalKey}`, 4],
    [`supabase:albums:${previewKey}`, 3],
    [`supabase:albums:${thumbnailKey}`, 2],
  ])
  const targetObjects = new Map<string, number>([
    [`r2:ciiya-media:${originalKey}`, 4],
    [`r2:ciiya-media:${previewKey}`, 3],
    [`r2:ciiya-media:${thumbnailKey}`, 2],
  ])
  const deleted: StorageObjectRef[] = []
  const sourceDeleteCalls: StorageObjectRef[][] = []
  const targetDeleteCalls: StorageObjectRef[][] = []
  const sourceAdapter = fakeAdapter({
    provider: 'supabase',
    objects: sourceObjects,
    deleted,
    deleteCalls: sourceDeleteCalls,
  })
  const targetAdapter = fakeAdapter({
    provider: 'r2',
    objects: targetObjects,
    deleteCalls: targetDeleteCalls,
  })

  const inspection = await inspectPhotoSourceCleanup({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter,
    targetAdapter,
  })
  assert.equal(inspection.length, 3)
  assert.equal(
    inspection.reduce((sum, item) => sum + item.sources.length, 0),
    3
  )
  assert.equal(sourceDeleteCalls.length, 0)

  const cleanup = await deleteVerifiedPhotoSources({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter,
    targetAdapter,
  })
  assert.equal(cleanup.objects, 3)
  assert.equal(cleanup.sourceObjectsFound, 3)
  assert.equal(cleanup.deleted, 3)
  assert.equal(cleanup.failed.length, 0)
  assert.equal(deleted.length, 3)
  assert.equal(sourceObjects.size, 0)
  assert.equal(targetObjects.size, 3)
  assert.equal(targetDeleteCalls.length, 0)

  const retryAfterSuccess = await deleteVerifiedPhotoSources({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter,
    targetAdapter,
  })
  assert.equal(retryAfterSuccess.sourceObjectsFound, 0)
  assert.equal(retryAfterSuccess.deleted, 0)

  const partialSources = new Map<string, number>([
    [`supabase:albums:${originalKey}`, 4],
    [`supabase:albums:${previewKey}`, 3],
    [`supabase:albums:${thumbnailKey}`, 2],
  ])
  const failedKey = `supabase:albums:${previewKey}`
  const partialAdapter = fakeAdapter({
    provider: 'supabase',
    objects: partialSources,
    failDeleteOnce: new Set([failedKey]),
  })
  const partial = await deleteVerifiedPhotoSources({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter: partialAdapter,
    targetAdapter,
  })
  assert.equal(partial.deleted, 2)
  assert.equal(partial.failed.length, 1)
  assert.equal(partialSources.size, 1)

  const partialRetry = await deleteVerifiedPhotoSources({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter: partialAdapter,
    targetAdapter,
  })
  assert.equal(partialRetry.sourceObjectsFound, 1)
  assert.equal(partialRetry.deleted, 1)
  assert.equal(partialRetry.failed.length, 0)
  assert.equal(partialSources.size, 0)

  const missingTarget = new Map(targetObjects)
  missingTarget.delete(`r2:ciiya-media:${previewKey}`)
  const guardedSources = new Map<string, number>([
    [`supabase:albums:${originalKey}`, 4],
    [`supabase:albums:${previewKey}`, 3],
    [`supabase:albums:${thumbnailKey}`, 2],
  ])
  const guardedDeleteCalls: StorageObjectRef[][] = []
  await assert.rejects(
    deleteVerifiedPhotoSources({
      photo,
      targetBucket: 'ciiya-media',
      sourceAdapter: fakeAdapter({
        provider: 'supabase',
        objects: guardedSources,
        deleteCalls: guardedDeleteCalls,
      }),
      targetAdapter: fakeAdapter({ provider: 'r2', objects: missingTarget }),
    }),
    /R2 cleanup target.*missing/
  )
  assert.equal(guardedDeleteCalls.length, 0)
  assert.equal(guardedSources.size, 3)

  const mismatchedTarget = new Map(targetObjects)
  mismatchedTarget.set(`r2:ciiya-media:${thumbnailKey}`, 99)
  await assert.rejects(
    inspectPhotoSourceCleanup({
      photo,
      targetBucket: 'ciiya-media',
      sourceAdapter: fakeAdapter({
        provider: 'supabase',
        objects: guardedSources,
      }),
      targetAdapter: fakeAdapter({
        provider: 'r2',
        objects: mismatchedTarget,
      }),
    }),
    /R2 cleanup target size mismatch/
  )

  const mismatchedSource = new Map(guardedSources)
  mismatchedSource.set(`supabase:albums:${previewKey}`, 88)
  await assert.rejects(
    inspectPhotoSourceCleanup({
      photo,
      targetBucket: 'ciiya-media',
      sourceAdapter: fakeAdapter({
        provider: 'supabase',
        objects: mismatchedSource,
      }),
      targetAdapter,
    }),
    /Cleanup source\/target size mismatch/
  )

  await assert.rejects(
    inspectPhotoSourceCleanup({
      photo: { ...photo, migration_attempts: 0 },
      targetBucket: 'ciiya-media',
      sourceAdapter: fakeAdapter({
        provider: 'supabase',
        objects: guardedSources,
      }),
      targetAdapter,
    }),
    /R2-native/
  )

  await assert.rejects(
    inspectPhotoSourceCleanup({
      photo: { ...photo, preview_path: `${ownerId}/../other/preview/photo.jpg` },
      targetBucket: 'ciiya-media',
      sourceAdapter: fakeAdapter({
        provider: 'supabase',
        objects: guardedSources,
      }),
      targetAdapter,
    }),
    /does not belong to the album owner|Invalid storage object key/
  )

  const cliSource = await readFile(
    'scripts/cleanup-migrated-supabase-sources.ts',
    'utf8'
  )
  const migrationSql = await readFile(
    'supabase/migrations/202609210009_delayed_supabase_source_cleanup.sql',
    'utf8'
  )
  assert.match(cliSource, /STORAGE_SOURCE_CLEANUP_APPLY_ENABLED/)
  assert.match(cliSource, /DELETE_VERIFIED_SUPABASE_SOURCES/)
  assert.match(cliSource, /--apply/)
  assert.match(cliSource, /r2Deletion: false/)
  assert.doesNotMatch(cliSource, /targetAdapter\.delete(Object|Objects)/)
  assert.match(migrationSql, /for update skip locked/)
  assert.match(migrationSql, /source_cleanup_after/)
  assert.match(migrationSql, /interval '30 days'/)
  assert.match(migrationSql, /to service_role/)
  assert.doesNotMatch(migrationSql, /delete\s+from/i)

  console.log('Phase 15 delayed Supabase source cleanup checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
