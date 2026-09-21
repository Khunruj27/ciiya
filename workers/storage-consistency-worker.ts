import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import {
  cleanupExpiredStorageReservations,
  getPhotoStorageCandidates,
  scanTrackedStorageObjects,
  storageObjectIdentity,
  type StorageConsistencyIssue,
} from '../src/lib/storage/consistency'
import { getStorageAdapter } from '../src/lib/storage'
import {
  processStorageDeletionJobs,
  recoverStagedStorageDeletionJobs,
} from '../src/lib/storage/deletion-jobs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase worker environment variables')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const POLL_INTERVAL = positiveNumber(
  process.env.STORAGE_CONSISTENCY_INTERVAL,
  60_000
)
const SCAN_BATCH_SIZE = Math.min(
  2000,
  positiveNumber(process.env.STORAGE_CONSISTENCY_BATCH_SIZE, 250)
)
const CLEANUP_DRY_RUN = process.env.STORAGE_CLEANUP_DRY_RUN !== 'false'
const workerId = `storage-consistency-${process.pid}`

let scanOffset = 0
let lastDailyCleanupAt = 0
let isShuttingDown = false
const wakeSleepers = new Set<() => void>()

console.log('[StorageConsistencyWorker] started', {
  batchSize: SCAN_BATCH_SIZE,
  cleanupDryRun: CLEANUP_DRY_RUN,
})

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      wakeSleepers.delete(finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    wakeSleepers.add(finish)
  })
}

function requestShutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`[StorageConsistencyWorker] received ${signal}, shutting down`)
  for (const wake of [...wakeSleepers]) wake()
}

process.on('SIGTERM', () => requestShutdown('SIGTERM'))
process.on('SIGINT', () => requestShutdown('SIGINT'))

async function persistIssue(issue: StorageConsistencyIssue) {
  const { data: existing, error: lookupError } = await supabase
    .from('storage_consistency_issues')
    .select('id')
    .eq('issue_type', issue.issueType)
    .eq('status', 'open')
    .eq('storage_provider', issue.ref.provider)
    .eq('bucket', issue.ref.bucket)
    .eq('storage_path', issue.ref.key)
    .maybeSingle()

  if (lookupError) throw new Error(lookupError.message)
  if (existing) return

  const { error } = await supabase.from('storage_consistency_issues').insert({
    issue_type: issue.issueType,
    owner_id: issue.ownerId,
    album_id: issue.albumId,
    photo_id: issue.photoId,
    storage_provider: issue.ref.provider,
    bucket: issue.ref.bucket,
    storage_path: issue.ref.key,
    severity: issue.issueType === 'missing_storage_file' ? 'high' : 'warning',
    status: 'open',
    details: {
      source: issue.source,
      expected_size_bytes: issue.expectedSizeBytes ?? null,
      actual_size_bytes: issue.actualSizeBytes ?? null,
    },
    detected_at: new Date().toISOString(),
  })

  if (error) throw new Error(error.message)
}

async function resolveHealthyObjects(
  refs: Awaited<ReturnType<typeof scanTrackedStorageObjects>>['healthyRefs']
) {
  for (const ref of refs) {
    const { error } = await supabase
      .from('storage_consistency_issues')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      })
      .eq('status', 'open')
      .eq('storage_provider', ref.provider)
      .eq('bucket', ref.bucket)
      .eq('storage_path', ref.key)

    if (error) throw new Error(error.message)
  }
}

async function queueRepairJobs(issues: StorageConsistencyIssue[]) {
  const photoIds = [
    ...new Set(
      issues
        .filter(
          (issue) =>
            issue.source === 'photos' &&
            issue.issueType === 'missing_storage_file' &&
            issue.photoId
        )
        .map((issue) => issue.photoId as string)
    ),
  ]
  if (photoIds.length === 0) return

  const { data: photos, error } = await supabase
    .from('photos')
    .select(
      'id, album_id, owner_id, user_id, original_path, storage_provider, storage_bucket'
    )
    .in('id', photoIds)
  if (error) throw new Error(error.message)

  for (const photo of photos || []) {
    const ownerId = photo.owner_id || photo.user_id
    if (!ownerId || !photo.album_id || !photo.original_path) continue
    const derivativeMissing = issues.some(
      (issue) =>
        issue.photoId === photo.id && issue.ref.key !== photo.original_path
    )
    if (!derivativeMissing) continue
    const originalCandidates = getPhotoStorageCandidates(
      photo,
      photo.original_path
    )
    let originalExists = false
    for (const ref of originalCandidates) {
      const head = await getStorageAdapter(ref.provider, { supabase }).objectExists(
        ref
      )
      if (head.exists) {
        originalExists = true
        break
      }
    }
    if (!originalExists) continue
    const { data: existing } = await supabase
      .from('photo_jobs')
      .select('id')
      .eq('photo_id', photo.id)
      .in('status', ['pending', 'processing'])
      .maybeSingle()
    if (existing) continue

    const { error: queueError } = await supabase.from('photo_jobs').upsert(
      {
        photo_id: photo.id,
        album_id: photo.album_id,
        owner_id: ownerId,
        original_path: photo.original_path,
        size: 'hd',
        status: 'pending',
        priority: 180,
        progress: 0,
        retry_count: 0,
        retries: 0,
        updated_at: new Date().toISOString(),
        payload: { source: 'storage-consistency-repair' },
      },
      { onConflict: 'photo_id' }
    )
    if (queueError) {
      console.error(
        '[StorageConsistencyWorker] repair queue failed:',
        queueError.message
      )
    }
  }
}

async function cleanupOldRows() {
  const cleanupTasks = [
    ['cleanup_storage_consistency_issues', { keep_days: 30 }],
    ['cleanup_worker_metrics', { keep_days: 30 }],
    ['cleanup_worker_logs', { keep_days: 90 }],
    ['cleanup_worker_heartbeats', { keep_days: 7 }],
  ] as const

  for (const [rpcName, params] of cleanupTasks) {
    const { error } = await supabase.rpc(rpcName, params)
    if (error) {
      console.error(`[StorageConsistencyWorker] ${rpcName} failed:`, error.message)
    }
  }
}

async function runCycle() {
  const scan = await scanTrackedStorageObjects({
    supabase,
    limit: SCAN_BATCH_SIZE,
    offset: scanOffset,
  })
  await Promise.all(scan.issues.map((issue) => persistIssue(issue)))
  await resolveHealthyObjects(scan.healthyRefs)
  await queueRepairJobs(scan.issues)

  const reachedEnd =
    scan.photoRowsScanned < SCAN_BATCH_SIZE &&
    scan.assetRowsScanned < SCAN_BATCH_SIZE
  scanOffset = reachedEnd ? 0 : scanOffset + SCAN_BATCH_SIZE

  const reservations = await cleanupExpiredStorageReservations({
    supabase,
    dryRun: CLEANUP_DRY_RUN,
    limit: 100,
    allowR2Delete:
      process.env.STORAGE_CLEANUP_ALLOW_R2_DELETE === 'true',
  })
  const recovered = await recoverStagedStorageDeletionJobs(supabase, 500)
  const deletions = await processStorageDeletionJobs({
    supabase,
    workerId,
    limit: 100,
  })

  const summary = {
    scan: {
      offset: scanOffset,
      checked: scan.checked,
      healthy: scan.healthy,
      missing: scan.missing,
      mismatched: scan.mismatched,
      skipped: scan.skipped,
      identities: scan.healthyRefs.slice(0, 3).map(storageObjectIdentity),
    },
    reservations,
    recovered,
    deletions,
  }
  console.log('[StorageConsistencyWorker] cycle complete', summary)

  await supabase.from('worker_logs').insert({
    worker_type: 'storage-consistency',
    level: scan.missing > 0 ? 'warning' : 'info',
    message: 'Provider-aware storage consistency cycle completed',
    metadata: summary,
  })
}

async function start() {
  while (!isShuttingDown) {
    try {
      await runCycle()
      if (Date.now() - lastDailyCleanupAt > 24 * 60 * 60 * 1000) {
        await cleanupOldRows()
        lastDailyCleanupAt = Date.now()
      }
    } catch (error) {
      console.error('[StorageConsistencyWorker] cycle failed:', error)
    }

    if (!isShuttingDown) await sleep(POLL_INTERVAL)
  }
  console.log('[StorageConsistencyWorker] graceful shutdown complete')
}

start().catch((error) => {
  console.error('[StorageConsistencyWorker] fatal:', error)
  process.exit(1)
})
