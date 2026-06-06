import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const DRY_RUN = process.env.CLEANUP_DRY_RUN !== 'false'

const DONE_JOBS_RETENTION_DAYS = Number(
  process.env.CLEANUP_DONE_JOBS_RETENTION_DAYS || 14
)
const FAILED_JOBS_RETENTION_DAYS = Number(
  process.env.CLEANUP_FAILED_JOBS_RETENTION_DAYS || 45
)
const WORKER_LOGS_RETENTION_DAYS = Number(
  process.env.CLEANUP_WORKER_LOGS_RETENTION_DAYS || 30
)

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

async function countRows(table: string, status: string | null, cutoff: string) {
  let query = supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .lt('created_at', cutoff)

  if (status) {
    query = query.eq('status', status)
  }

  const { count, error } = await query

  if (error) throw new Error(`[${table}] count failed: ${error.message}`)

  return count || 0
}

async function deleteRows(table: string, status: string | null, cutoff: string) {
  let query = supabase.from(table).delete().lt('created_at', cutoff)

  if (status) {
    query = query.eq('status', status)
  }

  const { error } = await query

  if (error) throw new Error(`[${table}] delete failed: ${error.message}`)
}

async function cleanupTable(params: {
  table: string
  label: string
  status: string | null
  retentionDays: number
}) {
  const cutoff = daysAgo(params.retentionDays)

  const count = await countRows(params.table, params.status, cutoff)

  console.log(
    `[CleanupOldJobs] ${params.label}: ${count} row(s) older than ${params.retentionDays} day(s)`
  )

  if (count === 0) return

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would delete ${count} row(s) from ${params.table}`)
    return
  }

  await deleteRows(params.table, params.status, cutoff)

  console.log(`[CleanupOldJobs] Deleted ${count} row(s) from ${params.table}`)
}

async function cleanup() {
  console.log('[CleanupOldJobs] started')
  console.log('[CleanupOldJobs] DRY_RUN =', DRY_RUN)

  await cleanupTable({
    table: 'photo_jobs',
    label: 'done photo_jobs',
    status: 'done',
    retentionDays: DONE_JOBS_RETENTION_DAYS,
  })

  await cleanupTable({
    table: 'photo_jobs',
    label: 'failed photo_jobs',
    status: 'failed',
    retentionDays: FAILED_JOBS_RETENTION_DAYS,
  })

  await cleanupTable({
    table: 'face_jobs',
    label: 'done face_jobs',
    status: 'done',
    retentionDays: DONE_JOBS_RETENTION_DAYS,
  })

  await cleanupTable({
    table: 'face_jobs',
    label: 'failed face_jobs',
    status: 'failed',
    retentionDays: FAILED_JOBS_RETENTION_DAYS,
  })

  await cleanupTable({
    table: 'worker_logs',
    label: 'worker_logs',
    status: null,
    retentionDays: WORKER_LOGS_RETENTION_DAYS,
  })

  console.log('[CleanupOldJobs] completed')
}

cleanup()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[CleanupOldJobs] fatal:', error)
    process.exit(1)
  })