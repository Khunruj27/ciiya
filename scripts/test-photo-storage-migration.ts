import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildPhotoStorageMigrationCompletion,
  copyPhotoStorageMigration,
  planPhotoStorageMigration,
  verifyPhotoStorageMigration,
  type PhotoStorageMigrationRow,
} from '../src/lib/storage/migration'
import type {
  StorageAdapter,
  StorageObjectHead,
  StorageObjectRef,
  UploadObjectOptions,
} from '../src/lib/storage/types'

function identity(ref: StorageObjectRef) {
  return `${ref.provider}:${ref.bucket}:${ref.key}`
}

function head(sizeBytes: number, contentType = 'image/jpeg'): StorageObjectHead {
  return {
    exists: true,
    sizeBytes,
    contentType,
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
  objects: Map<string, Buffer>
  uploads?: StorageObjectRef[]
  downloads?: StorageObjectRef[]
}) {
  return {
    provider: params.provider,
    async objectExists(ref: StorageObjectRef) {
      const body = params.objects.get(identity(ref))
      return body ? head(body.byteLength) : missing()
    },
    async downloadObject(ref: StorageObjectRef) {
      params.downloads?.push(ref)
      const body = params.objects.get(identity(ref))
      if (!body) throw new Error(`Missing fake object: ${identity(ref)}`)
      return Buffer.from(body)
    },
    async uploadObject(
      ref: StorageObjectRef,
      body: Uint8Array | Blob,
      options: UploadObjectOptions
    ) {
      assert.equal(options.upsert, false)
      assert.equal(body instanceof Blob, false)
      if (params.objects.has(identity(ref))) throw new Error('Object exists')
      const buffer = Buffer.from(body as Uint8Array)
      params.objects.set(identity(ref), buffer)
      params.uploads?.push(ref)
      return head(buffer.byteLength, options.contentType)
    },
    getPublicUrl(ref: StorageObjectRef) {
      return ref.key.includes('/preview/') || ref.key.includes('/thumbnail/')
        ? `https://media.example.com/${ref.key}`
        : null
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
  const photo: PhotoStorageMigrationRow = {
    id: '44444444-4444-4444-8444-444444444444',
    owner_id: ownerId,
    album_id: albumId,
    storage_provider: 'supabase',
    storage_version: 1,
    storage_path: previewKey,
    original_path: originalKey,
    preview_path: previewKey,
    thumbnail_path: thumbnailKey,
    original_size_bytes: 4,
    preview_size_bytes: 3,
    thumbnail_size_bytes: 2,
    mime_type: 'image/jpeg',
  }

  const sourceObjects = new Map<string, Buffer>([
    // The original deliberately lives in albums so the originals -> albums
    // legacy fallback is exercised.
    [`supabase:albums:${originalKey}`, Buffer.from([1, 2, 3, 4])],
    [`supabase:albums:${previewKey}`, Buffer.from([1, 2, 3])],
    [`supabase:albums:${thumbnailKey}`, Buffer.from([1, 2])],
  ])
  const targetObjects = new Map<string, Buffer>()
  const uploads: StorageObjectRef[] = []
  const downloads: StorageObjectRef[] = []
  const sourceAdapter = fakeAdapter({
    provider: 'supabase',
    objects: sourceObjects,
    downloads,
  })
  const targetAdapter = fakeAdapter({
    provider: 'r2',
    objects: targetObjects,
    uploads,
  })

  const plan = planPhotoStorageMigration(photo, 'ciiya-media')
  assert.equal(plan.length, 3)
  assert.deepEqual(
    plan.find((item) => item.key === previewKey)?.fields.sort(),
    ['preview_path', 'storage_path']
  )

  const copied = await copyPhotoStorageMigration({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter,
    targetAdapter,
    maxObjectBytes: 1024,
  })
  assert.equal(copied.copied, 3)
  assert.equal(copied.reused, 0)
  assert.equal(copied.bytes, 9)
  assert.equal(uploads.length, 3)
  assert.equal(downloads.length, 3)

  const verified = await verifyPhotoStorageMigration({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter,
    targetAdapter,
  })
  assert.equal(verified.verified, 3)
  assert.equal(verified.bytes, 9)

  const completion = buildPhotoStorageMigrationCompletion(
    photo,
    'ciiya-media',
    targetAdapter
  )
  assert.equal(completion.storage_provider, 'r2')
  assert.equal(completion.storage_bucket, 'ciiya-media')
  assert.equal(completion.preview_url, `https://media.example.com/${previewKey}`)
  assert.equal(
    completion.thumbnail_url,
    `https://media.example.com/${thumbnailKey}`
  )
  assert.equal(completion.original_url, null)
  assert.equal(completion.hd_url, null)

  const rerun = await copyPhotoStorageMigration({
    photo,
    targetBucket: 'ciiya-media',
    sourceAdapter,
    targetAdapter,
    maxObjectBytes: 1024,
  })
  assert.equal(rerun.copied, 0)
  assert.equal(rerun.reused, 3)
  assert.equal(uploads.length, 3)
  assert.equal(downloads.length, 3)

  const conflictObjects = new Map(targetObjects)
  conflictObjects.set(`r2:ciiya-media:${previewKey}`, Buffer.alloc(99))
  await assert.rejects(
    copyPhotoStorageMigration({
      photo,
      targetBucket: 'ciiya-media',
      sourceAdapter,
      targetAdapter: fakeAdapter({ provider: 'r2', objects: conflictObjects }),
      maxObjectBytes: 1024,
    }),
    /R2 size conflict/
  )

  await assert.rejects(
    copyPhotoStorageMigration({
      photo: { ...photo, original_size_bytes: 999 },
      targetBucket: 'ciiya-media',
      sourceAdapter,
      targetAdapter: fakeAdapter({ provider: 'r2', objects: new Map() }),
      maxObjectBytes: 1024,
    }),
    /Source size mismatch/
  )

  assert.throws(
    () =>
      planPhotoStorageMigration(
        { ...photo, preview_path: `${ownerId}/../other/preview/photo.jpg` },
        'ciiya-media'
      ),
    /does not belong to the album owner|Invalid storage object key/
  )

  const cliSource = await readFile('scripts/migrate-supabase-to-r2.ts', 'utf8')
  const migrationSql = await readFile(
    'supabase/migrations/202609210008_supabase_to_r2_photo_migration.sql',
    'utf8'
  )
  assert.match(cliSource, /STORAGE_MIGRATION_APPLY_ENABLED/)
  assert.match(cliSource, /transport: WebSocket/)
  assert.match(cliSource, /sourceDeletion: false/)
  assert.doesNotMatch(cliSource, /deleteObject\(|deleteObjects\(|\.remove\(/)
  assert.match(migrationSql, /for update skip locked/)
  assert.doesNotMatch(migrationSql, /delete\s+from/i)

  console.log('Phase 13 photo storage migration checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
