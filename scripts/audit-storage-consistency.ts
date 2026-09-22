import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { scanTrackedStorageObjects } from '../src/lib/storage/consistency'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const batchSize = Math.min(
    2000,
    positiveInteger(process.env.STORAGE_AUDIT_BATCH_SIZE, 250)
  )
  const maxRows = Math.min(
    100_000,
    positiveInteger(process.env.STORAGE_AUDIT_MAX_ROWS, 100_000)
  )
  const totals = {
    photoRowsScanned: 0,
    assetRowsScanned: 0,
    checked: 0,
    healthy: 0,
    missing: 0,
    mismatched: 0,
    skipped: 0,
  }
  const issueCounts = new Map<string, number>()
  let offset = 0
  let truncated = false

  while (offset < maxRows) {
    const scan = await scanTrackedStorageObjects({
      supabase,
      limit: Math.min(batchSize, maxRows - offset),
      offset,
    })

    totals.photoRowsScanned += scan.photoRowsScanned
    totals.assetRowsScanned += scan.assetRowsScanned
    totals.checked += scan.checked
    totals.healthy += scan.healthy
    totals.missing += scan.missing
    totals.mismatched += scan.mismatched
    totals.skipped += scan.skipped

    for (const issue of scan.issues) {
      const key = `${issue.source}:${issue.issueType}:${issue.ref.provider}`
      issueCounts.set(key, (issueCounts.get(key) || 0) + 1)
    }

    if (
      scan.photoRowsScanned < batchSize &&
      scan.assetRowsScanned < batchSize
    ) {
      break
    }
    offset += batchSize
  }

  if (offset >= maxRows) truncated = true

  const { count: recordedOpenIssues, error: issueError } = await supabase
    .from('storage_consistency_issues')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')

  if (issueError) {
    throw new Error(`Unable to inspect recorded consistency issues: ${issueError.message}`)
  }

  const summary = {
    mode: 'read-only',
    destructiveActions: false,
    ...totals,
    currentIssueCounts: Object.fromEntries(
      [...issueCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    recordedOpenIssues: recordedOpenIssues || 0,
    truncated,
  }

  console.log(JSON.stringify(summary, null, 2))

  if (totals.missing > 0 || totals.mismatched > 0 || truncated) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      mode: 'read-only',
      destructiveActions: false,
      error: error instanceof Error ? error.message : String(error),
    })
  )
  process.exitCode = 1
})
