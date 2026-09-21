import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildLegacyGuestMomentDeletionTarget,
  buildAlbumObjectDeletionTarget,
  buildPhotoDeletionTargets,
  processStorageDeletionJobs,
  reconcileStorageDeletionResult,
  storageDeletionRetryDelayMs,
  type StorageDeletionJob,
} from '../src/lib/storage/deletion-jobs'
import type { StorageAdapter } from '../src/lib/storage/types'

const ownerId = '11111111-1111-4111-8111-111111111111'
const albumId = '22222222-2222-4222-8222-222222222222'
const photoId = '33333333-3333-4333-8333-333333333333'
const originalPath = `${ownerId}/${albumId}/original/${photoId}.jpg`
const previewPath = `${ownerId}/${albumId}/preview/${photoId}.jpg`

const supabaseTargets = buildPhotoDeletionTargets({
  ownerId,
  albumId,
  photo: {
    id: photoId,
    album_id: albumId,
    storage_provider: 'supabase',
    storage_path: originalPath,
    original_path: originalPath,
    preview_path: previewPath,
  },
})

assert.deepEqual(
  supabaseTargets.map(({ ref }) => `${ref.bucket}:${ref.key}`).sort(),
  [
    `albums:${originalPath}`,
    `albums:${previewPath}`,
    `originals:${originalPath}`,
  ].sort(),
  'legacy originals must be cleaned from both compatible Supabase buckets'
)

const r2Targets = buildPhotoDeletionTargets({
  ownerId,
  albumId,
  photo: {
    id: photoId,
    album_id: albumId,
    storage_provider: 'r2',
    storage_bucket: 'ciiya-media',
    original_path: originalPath,
    preview_path: previewPath,
  },
})

assert.equal(r2Targets.length, 2)
assert.ok(r2Targets.every(({ ref }) => ref.provider === 'r2'))
assert.ok(r2Targets.every(({ ref }) => ref.bucket === 'ciiya-media'))

assert.throws(
  () =>
    buildPhotoDeletionTargets({
      ownerId,
      albumId,
      photo: {
        id: photoId,
        album_id: albumId,
        storage_provider: 'r2',
        storage_bucket: 'ciiya-media',
        original_path: `99999999-9999-4999-8999-999999999999/${albumId}/original/${photoId}.jpg`,
      },
    }),
  /does not belong/,
  'a deletion must never escape the authorized owner/album prefix'
)

assert.throws(
  () =>
    buildAlbumObjectDeletionTarget({
      provider: 'supabase',
      bucket: 'albums',
      key: `${ownerId}/${albumId}/unexpected/file.jpg`,
      ownerId,
      albumId,
    }),
  /does not belong/,
  'album cleanup must be limited to known storage folders'
)

const legacyMoment = buildLegacyGuestMomentDeletionTarget({
  albumId,
  key: `${albumId}/2026-09-21/${photoId}.jpg`,
})
assert.equal(legacyMoment.ref.provider, 'supabase')
assert.equal(legacyMoment.ref.bucket, 'guest-moments')
assert.throws(
  () =>
    buildLegacyGuestMomentDeletionTarget({
      albumId,
      key: `99999999-9999-4999-8999-999999999999/2026-09-21/${photoId}.jpg`,
    }),
  /does not belong/,
  'legacy Guest Moment cleanup must stay inside its album prefix'
)

const jobs: StorageDeletionJob[] = r2Targets.map(({ ref }, index) => ({
  id: `job-${index}`,
  operation_id: '44444444-4444-4444-8444-444444444444',
  owner_id: ownerId,
  album_id: albumId,
  photo_id: photoId,
  storage_provider: 'r2',
  storage_bucket: ref.bucket,
  object_key: ref.key,
  retry_count: 0,
  max_retries: 10,
}))

const reconciled = reconcileStorageDeletionResult(jobs, {
  deleted: [r2Targets[0].ref],
  failed: [],
})

assert.equal(reconciled.completed.length, 1)
assert.equal(reconciled.failed.length, 1)
assert.match(reconciled.failed[0].error, /returned no result/)
assert.equal(storageDeletionRetryDelayMs(0), 30_000)
assert.equal(storageDeletionRetryDelayMs(1), 60_000)
assert.equal(storageDeletionRetryDelayMs(100), 24 * 60 * 60 * 1000)

const updates: Array<Record<string, unknown>> = []
const queryResult = Promise.resolve({ error: null })
const chain = {
  in() {
    return this
  },
  eq() {
    return this
  },
  then: queryResult.then.bind(queryResult),
}
const fakeSupabase = {
  rpc: async () => ({ data: jobs, error: null }),
  from: () => ({
    update: (payload: Record<string, unknown>) => {
      updates.push(payload)
      return chain
    },
  }),
} as unknown as SupabaseClient
const fakeAdapter = {
  provider: 'r2',
  deleteObjects: async () => ({
    deleted: [r2Targets[0].ref],
    failed: [{ ref: r2Targets[1].ref, error: 'temporary outage' }],
  }),
} as unknown as StorageAdapter

async function testPartialProcessing() {
  const processed = await processStorageDeletionJobs({
    supabase: fakeSupabase,
    workerId: 'test-worker',
    adapterFactory: () => fakeAdapter,
  })

  assert.deepEqual(processed, { claimed: 2, completed: 1, failed: 1 })
  assert.ok(updates.some((update) => update.status === 'completed'))
  assert.ok(
    updates.some(
      (update) =>
        update.status === 'failed' &&
        update.retry_count === 1 &&
        update.last_error === 'temporary outage'
    )
  )

  console.log('Storage deletion planning and partial-result checks passed')
}

testPartialProcessing().catch((error) => {
  console.error(error)
  process.exit(1)
})
