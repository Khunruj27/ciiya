import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { getR2Config } from '../src/lib/storage/config'
import { runStorageOrphanCleanup } from '../src/lib/storage/consistency'
import type { StorageProvider } from '../src/lib/storage/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

async function main() {
  const provider: StorageProvider =
    process.env.CLEANUP_STORAGE_PROVIDER === 'r2' ? 'r2' : 'supabase'
  const dryRun = process.env.CLEANUP_DRY_RUN !== 'false'
  const bucket =
    provider === 'r2'
      ? getR2Config().bucketName
      : process.env.CLEANUP_STORAGE_BUCKET || 'albums'
  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const result = await runStorageOrphanCleanup({
    supabase,
    provider,
    bucket,
    prefix: process.env.CLEANUP_STORAGE_PREFIX || '',
    dryRun,
    maxDelete: positiveNumber(process.env.CLEANUP_DELETE_LIMIT, 100),
    scanLimit: positiveNumber(process.env.CLEANUP_SCAN_LIMIT, 10_000),
    allowR2Delete: process.env.STORAGE_CLEANUP_ALLOW_R2_DELETE === 'true',
  })

  console.log('[Cleanup] result:', JSON.stringify(result, null, 2))
  if (result.truncated) {
    console.warn('[Cleanup] inventory was truncated; rerun with a narrower prefix')
  }
  if (result.failedCount > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('[Cleanup] fatal:', error)
  process.exitCode = 1
})
