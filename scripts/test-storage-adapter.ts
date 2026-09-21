import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  assertOwnedAlbumObjectKey,
  createR2StorageAdapter,
  createStorageRef,
  createSupabaseStorageAdapter,
  generatedDownloadKey,
  guestMomentImageKey,
  isPublicDeliveryKey,
  photoObjectKey,
  portfolioImageKey,
  presetObjectKey,
} from '../src/lib/storage'
import type { S3Client } from '@aws-sdk/client-s3'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  estimatePhotoStorageBytes,
  hasMatchingPhotoExtension,
  hasUnsafeUploadPath,
  normalizeDirectPhotoMimeType,
  normalizePhotoFileHash,
  normalizeRequestedPhotoSize,
} from '../src/lib/storage/photo-upload-policy'

async function main() {
  const ownerId = randomUUID()
  const albumId = randomUUID()
  const objectId = randomUUID()

  assert.equal(normalizeDirectPhotoMimeType('IMAGE/JPEG'), 'image/jpeg')
  assert.equal(normalizeDirectPhotoMimeType('image/gif'), null)
  assert.equal(hasMatchingPhotoExtension('photo.JPEG', 'image/jpeg'), true)
  assert.equal(hasMatchingPhotoExtension('photo.png', 'image/jpeg'), false)
  assert.equal(normalizeRequestedPhotoSize('unsupported'), 'original')
  assert.equal(estimatePhotoStorageBytes(1_000), 1_400)
  assert.equal(hasUnsafeUploadPath('../secret.jpg'), true)
  assert.equal(hasUnsafeUploadPath('safe/preset.xmp'), false)
  assert.match(
    normalizePhotoFileHash({
      providedHash: 'photo.jpg-100-123',
      fileName: 'photo.jpg',
      fileSizeBytes: 100,
      lastModified: 123,
    }),
    /^[a-f0-9]{64}$/
  )

  const originalKey = photoObjectKey({
    ownerId,
    albumId,
    objectId,
    kind: 'original',
  })
  const previewKey = photoObjectKey({
    ownerId,
    albumId,
    objectId,
    kind: 'preview',
  })

  assert.equal(
    originalKey,
    `${ownerId}/${albumId}/original/${objectId}.jpg`
  )
  assert.equal(
    assertOwnedAlbumObjectKey(originalKey, ownerId, albumId),
    originalKey
  )
  assert.throws(() =>
    assertOwnedAlbumObjectKey(originalKey, randomUUID(), albumId)
  )
  assert.throws(() =>
    createStorageRef({
      provider: 'r2',
      bucket: 'ciiya-assets',
      key: `${ownerId}/${albumId}/original/../secret.jpg`,
    })
  )

  assert.equal(isPublicDeliveryKey(originalKey), false)
  assert.equal(isPublicDeliveryKey(previewKey), true)
  assert.equal(
    isPublicDeliveryKey(portfolioImageKey({ ownerId, objectId })),
    true
  )
  assert.equal(
    isPublicDeliveryKey(
      guestMomentImageKey({ ownerId, albumId, objectId })
    ),
    true
  )
  assert.equal(
    isPublicDeliveryKey(presetObjectKey({ ownerId, objectId })),
    false
  )
  assert.equal(
    isPublicDeliveryKey(
      generatedDownloadKey({ ownerId, albumId, objectId })
    ),
    false
  )

  const fakeClient = {
    async send() {
      return {
        ContentLength: 123,
        ContentType: 'image/jpeg',
        ETag: '"test-etag"',
        LastModified: new Date('2026-01-01T00:00:00.000Z'),
      }
    },
  } as unknown as S3Client

  const adapter = createR2StorageAdapter(
    {
      accountId: 'test-account',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      bucketName: 'ciiya-assets',
      endpoint: 'https://test-account.r2.cloudflarestorage.com',
      publicBaseUrl: 'https://cdn.example.com',
    },
    fakeClient
  )

  const previewRef = createStorageRef({
    provider: 'r2',
    bucket: 'ciiya-assets',
    key: previewKey,
  })
  const originalRef = createStorageRef({
    provider: 'r2',
    bucket: 'ciiya-assets',
    key: originalKey,
  })

  assert.equal(
    adapter.getPublicUrl(previewRef),
    `https://cdn.example.com/${previewKey}`
  )
  assert.equal(adapter.getPublicUrl(originalRef), null)
  await assert.rejects(() =>
    adapter.objectExists(
      createStorageRef({
        provider: 'r2',
        bucket: 'another-bucket',
        key: previewKey,
      })
    )
  )

  const head = await adapter.objectExists(previewRef)
  assert.deepEqual(head, {
    exists: true,
    sizeBytes: 123,
    contentType: 'image/jpeg',
    etag: 'test-etag',
    lastModified: new Date('2026-01-01T00:00:00.000Z'),
  })

  const missingR2Adapter = createR2StorageAdapter(
    {
      accountId: 'test-account',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      bucketName: 'ciiya-assets',
      endpoint: 'https://test-account.r2.cloudflarestorage.com',
      publicBaseUrl: null,
    },
    {
      async send() {
        throw Object.assign(new Error('missing'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
      },
    } as unknown as S3Client
  )

  assert.deepEqual(await missingR2Adapter.objectExists(previewRef), {
    exists: false,
    sizeBytes: null,
    contentType: null,
    etag: null,
    lastModified: null,
  })

  function fakeSupabaseClient(status: number) {
    return {
      storage: {
        from() {
          return {
            async info() {
              return {
                data: null,
                error: Object.assign(new Error(`storage error ${status}`), {
                  status,
                }),
              }
            },
          }
        },
      },
    } as unknown as SupabaseClient
  }

  const supabaseRef = createStorageRef({
    provider: 'supabase',
    bucket: 'albums',
    key: originalKey,
  })
  const missingSupabaseAdapter = createSupabaseStorageAdapter(
    fakeSupabaseClient(404)
  )

  assert.deepEqual(await missingSupabaseAdapter.objectExists(supabaseRef), {
    exists: false,
    sizeBytes: null,
    contentType: null,
    etag: null,
    lastModified: null,
  })

  const failingSupabaseAdapter = createSupabaseStorageAdapter(
    fakeSupabaseClient(503)
  )
  await assert.rejects(
    failingSupabaseAdapter.objectExists(supabaseRef),
    /storage error 503/
  )

  const signingAdapter = createR2StorageAdapter({
    accountId: 'test-account',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucketName: 'ciiya-assets',
    endpoint: 'https://test-account.r2.cloudflarestorage.com',
    publicBaseUrl: null,
  })
  const signedUpload = await signingAdapter.getSignedUploadUrl(previewRef, {
    contentType: 'image/jpeg',
    contentLength: 123,
    expiresInSeconds: 300,
  })

  assert.equal(signedUpload.method, 'PUT')
  assert.equal(signedUpload.headers['Content-Type'], 'image/jpeg')
  assert.equal(signedUpload.headers['If-None-Match'], '*')
  assert.match(signedUpload.url, /X-Amz-Expires=300/)
  await assert.rejects(
    signingAdapter.getSignedUploadUrl(previewRef, {
      contentType: 'image/jpeg',
      contentLength: 0,
      expiresInSeconds: 300,
    }),
    /content length/
  )
  await assert.rejects(
    signingAdapter.getSignedDownloadUrl(previewRef, {
      expiresInSeconds: 604_801,
    }),
    /expiration/
  )

  console.log('Storage adapter contract checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
