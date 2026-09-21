import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  createCameraUploadPlan,
  ensureCameraUploadObject,
  hashCameraPhoto,
} from '../src/lib/storage/camera-upload'
import type {
  StorageAdapter,
  StorageObjectHead,
  StorageObjectRef,
} from '../src/lib/storage'

async function main() {
  const workerSource = await readFile(
    new URL('../workers/camera-live-import-worker.ts', import.meta.url),
    'utf8'
  )
  const finalizerSource = await readFile(
    new URL('../src/app/api/photos/finalize-upload/route.ts', import.meta.url),
    'utf8'
  )

  assert.doesNotMatch(workerSource, /supabase\.storage|storage\.from\(/)
  assert.match(workerSource, /getStorageAdapter\(plan\.provider/)
  assert.match(workerSource, /reserve_camera_photo_upload/)
  assert.match(
    workerSource,
    /\['pending', 'imported', 'uploading', 'finalizing', 'uploaded'\]/
  )
  assert.match(finalizerSource, /begin_camera_photo_upload_finalization/)
  assert.match(finalizerSource, /complete_camera_photo_upload_finalization/)
  assert.match(finalizerSource, /Camera import binding is worker-only/)

const ownerId = '11111111-1111-4111-8111-111111111111'
const albumId = '22222222-2222-4222-8222-222222222222'
const importId = '33333333-3333-4333-8333-333333333333'

const r2Plan = createCameraUploadPlan({
  ownerId,
  albumId,
  importId,
  useR2: true,
  r2Bucket: 'ciiya-photos',
  existingProvider: 'supabase',
  existingBucket: 'albums',
  legacySupabaseKey: `${ownerId}/${albumId}/original/legacy.jpg`,
})

assert.deepEqual(r2Plan, {
  provider: 'r2',
  bucket: 'ciiya-photos',
  key: `${ownerId}/${albumId}/original/${importId}.jpg`,
  uploadSessionId: null,
})

const legacyPlan = createCameraUploadPlan({
  ownerId,
  albumId,
  importId,
  useR2: true,
  r2Bucket: 'ciiya-photos',
  existingProvider: 'supabase',
  existingBucket: 'albums',
  existingKey: `${ownerId}/${albumId}/original/already-uploaded.jpg`,
  legacySupabaseKey: `${ownerId}/${albumId}/original/new.jpg`,
})

assert.equal(legacyPlan.provider, 'supabase')
assert.equal(legacyPlan.bucket, 'albums')
assert.match(legacyPlan.key, /already-uploaded\.jpg$/)

const r2RetryPlan = createCameraUploadPlan({
  ownerId,
  albumId,
  importId,
  useR2: false,
  existingProvider: 'r2',
  existingBucket: 'ciiya-photos',
  existingKey: r2Plan.key,
  existingUploadSessionId: '44444444-4444-4444-8444-444444444444',
  legacySupabaseKey: `${ownerId}/${albumId}/original/new.jpg`,
})

assert.equal(r2RetryPlan.provider, 'r2')
assert.equal(
  r2RetryPlan.uploadSessionId,
  '44444444-4444-4444-8444-444444444444'
)

const body = Buffer.from('camera-photo-test')
assert.equal(hashCameraPhoto(body).length, 64)
assert.equal(hashCameraPhoto(body), hashCameraPhoto(body))

function head(
  exists: boolean,
  sizeBytes: number | null = null
): StorageObjectHead {
  return {
    exists,
    sizeBytes,
    contentType: exists ? 'image/jpeg' : null,
    etag: null,
    lastModified: null,
  }
}

function adapter(existing: StorageObjectHead) {
  let uploads = 0
  const storage: StorageAdapter = {
    provider: 'r2',
    async objectExists() {
      return existing
    },
    async uploadObject(_ref, uploadedBody) {
      uploads += 1
      return head(
        true,
        uploadedBody instanceof Blob ? uploadedBody.size : uploadedBody.byteLength
      )
    },
    async downloadObject() {
      throw new Error('not used')
    },
    async deleteObject() {},
    async deleteObjects() {
      return { deleted: [], failed: [] }
    },
    async getSignedUploadUrl() {
      throw new Error('not used')
    },
    async getSignedDownloadUrl() {
      throw new Error('not used')
    },
    getPublicUrl() {
      return null
    },
  }

  return { storage, uploads: () => uploads }
}

const ref: StorageObjectRef = {
  provider: 'r2',
  bucket: 'ciiya-photos',
  key: r2Plan.key,
}

const missing = adapter(head(false))
const uploaded = await ensureCameraUploadObject({
  adapter: missing.storage,
  ref,
  body,
})
assert.equal(uploaded.reused, false)
assert.equal(missing.uploads(), 1)

const present = adapter(head(true, body.byteLength))
const reused = await ensureCameraUploadObject({
  adapter: present.storage,
  ref,
  body,
})
assert.equal(reused.reused, true)
assert.equal(present.uploads(), 0)

await assert.rejects(
  ensureCameraUploadObject({
    adapter: adapter(head(true, body.byteLength + 1)).storage,
    ref,
    body,
  }),
  /size does not match/
)

console.log('Camera storage planning and retry checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
