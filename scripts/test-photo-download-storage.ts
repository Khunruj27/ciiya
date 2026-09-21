import assert from 'node:assert/strict'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildPhotoDownloadStoragePlan,
  normalizePhotoStorageProvider,
} from '../src/lib/storage/photo-download-plan'
import { resolvePhotoDownload } from '../src/lib/photo-download'
import type {
  StorageAdapter,
  StorageObjectRef,
  UploadObjectOptions,
} from '../src/lib/storage'

const originalPath =
  'owner-id/album-id/original/33333333-3333-4333-8333-333333333333.jpg'
const hdPath = originalPath.replace('/original/', '/hd/')

assert.equal(normalizePhotoStorageProvider(null), 'supabase')
assert.equal(normalizePhotoStorageProvider('r2'), 'r2')
assert.throws(
  () => normalizePhotoStorageProvider('unknown'),
  /Unsupported photo storage provider/
)

assert.deepEqual(
  buildPhotoDownloadStoragePlan({
    storageProvider: 'supabase',
    path: originalPath,
  }),
  {
    provider: 'supabase',
    buckets: ['originals', 'albums'],
  }
)

assert.deepEqual(
  buildPhotoDownloadStoragePlan({
    storageProvider: null,
    path: hdPath,
  }),
  {
    provider: 'supabase',
    buckets: ['albums'],
  }
)

assert.deepEqual(
  buildPhotoDownloadStoragePlan({
    storageProvider: 'r2',
    storageBucket: 'ciiya-assets',
    path: originalPath,
  }),
  {
    provider: 'r2',
    buckets: ['ciiya-assets'],
  }
)

assert.throws(
  () =>
    buildPhotoDownloadStoragePlan({
      storageProvider: 'r2',
      storageBucket: null,
      path: hdPath,
    }),
  /missing storage_bucket/
)

async function testR2DownloadResolution() {
  const uploaded: Array<{
    ref: StorageObjectRef
    body: Uint8Array | Blob
    options: UploadObjectOptions
  }> = []
  const updates: Record<string, unknown>[] = []
  const sourceBuffer = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: '#c7a86b',
    },
  })
    .jpeg()
    .toBuffer()
  const storageAdapter = {
    provider: 'r2',
    async downloadObject() {
      return Buffer.from(sourceBuffer)
    },
    async uploadObject(
      ref: StorageObjectRef,
      body: Uint8Array | Blob,
      options: UploadObjectOptions
    ) {
      uploaded.push({ ref, body, options })
      return {
        exists: true,
        sizeBytes: body instanceof Blob ? body.size : body.byteLength,
        contentType: options.contentType,
        etag: 'test',
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
      }
    },
  } as unknown as StorageAdapter
  const supabase = {
    from(table: string) {
      assert.equal(table, 'photos')

      return {
        update(payload: Record<string, unknown>) {
          updates.push(payload)

          return {
            async eq(column: string, value: string) {
              assert.equal(column, 'id')
              assert.equal(value, 'photo-id')
              return { error: null }
            },
          }
        },
      }
    },
  } as unknown as SupabaseClient
  const photo = {
    id: 'photo-id',
    album_id: 'album-id',
    owner_id: 'owner-id',
    filename: 'wedding.jpg',
    mime_type: 'image/jpeg',
    original_path: originalPath,
    preview_path: originalPath.replace('/original/', '/preview/'),
    storage_path: originalPath.replace('/original/', '/preview/'),
    storage_provider: 'r2',
    storage_bucket: 'ciiya-assets',
  }

  const original = await resolvePhotoDownload({
    supabase,
    storageAdapter,
    photo,
    album: {
      id: 'album-id',
      download_size: 'original',
      allow_original_download: true,
    },
  })

  assert.equal(original.size, 'original')
  assert.deepEqual(original.buffer, sourceBuffer)
  original.buffer.fill(0)
  assert.equal(uploaded.length, 0)

  const hd = await resolvePhotoDownload({
    supabase,
    storageAdapter,
    photo,
    album: {
      id: 'album-id',
      download_size: 'hd',
    },
  })

  assert.equal(hd.size, 'hd')
  assert.equal(uploaded.length, 1)
  assert.equal(uploaded[0].ref.provider, 'r2')
  assert.equal(uploaded[0].ref.bucket, 'ciiya-assets')
  assert.equal(uploaded[0].ref.key, hdPath)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].hd_path, hdPath)
  assert.equal(updates[0].hd_url, null)
  hd.buffer.fill(0)
  sourceBuffer.fill(0)
}

testR2DownloadResolution()
  .then(() => {
    console.log('Photo download storage plan checks passed')
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
