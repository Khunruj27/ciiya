import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getPhotoStorageCandidates,
  getProtectedSupabaseSourceCandidates,
  runStorageOrphanCleanup,
  storageObjectIdentity,
} from '../src/lib/storage/consistency'
import type {
  StorageAdapter,
  StorageObjectRef,
  StorageProvider,
} from '../src/lib/storage/types'

function emptySupabase() {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of [
    'select',
    'in',
    'eq',
    'lt',
    'order',
    'limit',
    'range',
  ]) {
    builder[method] = chain
  }
  builder.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown
  ) => Promise.resolve({ data: [], error: null }).then(resolve)

  return {
    from: () => builder,
  } as unknown as SupabaseClient
}

function fakeAdapter(
  provider: StorageProvider,
  ref: StorageObjectRef,
  deleted: StorageObjectRef[]
) {
  return {
    provider,
    listObjects: async () => ({
      objects: [
        {
          ref,
          exists: true,
          sizeBytes: 100,
          contentType: 'image/jpeg',
          etag: 'etag',
          lastModified: new Date(Date.now() - 48 * 60 * 60 * 1000),
        },
      ],
      nextCursor: null,
    }),
    deleteObjects: async (refs: StorageObjectRef[]) => {
      deleted.push(...refs)
      return { deleted: refs, failed: [] }
    },
  } as unknown as StorageAdapter
}

async function main() {
const supabaseOriginals = getPhotoStorageCandidates(
  {
    id: 'photo',
    album_id: 'album',
    storage_provider: 'supabase',
  },
  'owner/album/original/file.jpg'
)
assert.deepEqual(
  supabaseOriginals.map((ref) => ref.bucket),
  ['originals', 'albums']
)

const r2Candidate = getPhotoStorageCandidates(
  {
    id: 'photo',
    album_id: 'album',
    storage_provider: 'r2',
    storage_bucket: 'ciiya-media',
  },
  'owner/album/preview/file.jpg'
)
assert.equal(r2Candidate.length, 1)
assert.equal(
  storageObjectIdentity(r2Candidate[0]),
  'r2\0ciiya-media\0owner/album/preview/file.jpg'
)

const retainedSources = getProtectedSupabaseSourceCandidates(
  {
    id: 'migrated-photo',
    album_id: 'album',
    storage_provider: 'r2',
    storage_bucket: 'ciiya-media',
    migration_status: 'completed',
    migration_attempts: 1,
    source_cleanup_status: 'retained',
  },
  'owner/album/original/file.jpg'
)
assert.deepEqual(
  retainedSources.map((ref) => `${ref.provider}:${ref.bucket}`),
  ['supabase:originals', 'supabase:albums']
)

const preSchemaSources = getProtectedSupabaseSourceCandidates(
  {
    id: 'migrated-photo',
    album_id: 'album',
    storage_provider: 'r2',
    storage_bucket: 'ciiya-media',
    migration_status: 'completed',
    migration_attempts: 1,
  },
  'owner/album/preview/file.jpg'
)
assert.equal(preSchemaSources.length, 1)
assert.equal(preSchemaSources[0].bucket, 'albums')

assert.equal(
  getProtectedSupabaseSourceCandidates(
    {
      id: 'cleaned-photo',
      album_id: 'album',
      storage_provider: 'r2',
      storage_bucket: 'ciiya-media',
      migration_status: 'completed',
      migration_attempts: 1,
      source_cleanup_status: 'completed',
    },
    'owner/album/preview/file.jpg'
  ).length,
  0
)

assert.equal(
  getProtectedSupabaseSourceCandidates(
    {
      id: 'r2-native-photo',
      album_id: 'album',
      storage_provider: 'r2',
      storage_bucket: 'ciiya-media',
      migration_status: 'completed',
      migration_attempts: 0,
      source_cleanup_status: 'not_applicable',
    },
    'owner/album/preview/file.jpg'
  ).length,
  0
)

const supabase = emptySupabase()
const supabaseRef: StorageObjectRef = {
  provider: 'supabase',
  bucket: 'albums',
  key: 'owner/album/preview/orphan.jpg',
}
const deleted: StorageObjectRef[] = []
const adapterFactory = () => fakeAdapter('supabase', supabaseRef, deleted)
const dryRun = await runStorageOrphanCleanup({
  supabase,
  provider: 'supabase',
  bucket: 'albums',
  dryRun: true,
  adapterFactory,
})
assert.equal(dryRun.orphanCount, 1)
assert.equal(dryRun.deletedCount, 0)
assert.equal(deleted.length, 0)

const applied = await runStorageOrphanCleanup({
  supabase,
  provider: 'supabase',
  bucket: 'albums',
  dryRun: false,
  adapterFactory,
})
assert.equal(applied.deletedCount, 1)
assert.equal(deleted.length, 1)

await assert.rejects(
  runStorageOrphanCleanup({
    supabase,
    provider: 'r2',
    bucket: 'ciiya-media',
    dryRun: false,
    adapterFactory: () =>
      fakeAdapter(
        'r2',
        { ...supabaseRef, provider: 'r2', bucket: 'ciiya-media' },
        []
      ),
  }),
  /R2 orphan deletion is disabled/
)

const workerSource = await readFile(
  'workers/storage-consistency-worker.ts',
  'utf8'
)
assert.match(workerSource, /scanTrackedStorageObjects/)
assert.match(workerSource, /cleanupExpiredStorageReservations/)
assert.match(workerSource, /processStorageDeletionJobs/)
assert.doesNotMatch(workerSource, /supabase\.storage/)

const cleanupRouteSource = await readFile(
  'src/app/api/storage/cleanup-orphan/route.ts',
  'utf8'
)
assert.match(cleanupRouteSource, /runStorageOrphanCleanup/)
assert.match(cleanupRouteSource, /STORAGE_CLEANUP_ALLOW_R2_DELETE/)
assert.doesNotMatch(cleanupRouteSource, /\.storage\.from/)

const consistencySource = await readFile(
  'src/lib/storage/consistency.ts',
  'utf8'
)
assert.match(consistencySource, /select\('cover_url, album_preset_path'\)/)
assert.doesNotMatch(consistencySource, /select\([^)]*cover_path/)
assert.doesNotMatch(consistencySource, /profiles'\)\.select\('avatar_path/)
assert.match(consistencySource, /normalized\.includes\('\/profile\/'\)/)

const auditSource = await readFile(
  'scripts/audit-storage-consistency.ts',
  'utf8'
)
assert.match(auditSource, /transport: WebSocket/)

console.log('Phase 11 storage consistency and cleanup checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
