import dotenv from 'dotenv'

dotenv.config({
  path: '.env.local',
})

function getBooleanEnv(name: string, defaultValue: boolean) {
  const value = process.env[name]

  if (!value) return defaultValue

  return value === 'true' || value === '1'
}

function getNumberEnv(name: string, defaultValue: number) {
  const value = Number(process.env[name])

  if (!Number.isFinite(value) || value <= 0) {
    return defaultValue
  }

  return value
}

async function main() {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  const workerSecret = process.env.WORKER_SECRET || ''

  const dryRun = getBooleanEnv('STORAGE_CLEANUP_DRY_RUN', true)
  const limit = getNumberEnv('STORAGE_CLEANUP_LIMIT', 20)
  const scanLimit = getNumberEnv('STORAGE_CLEANUP_SCAN_LIMIT', 10_000)
  const provider =
    process.env.STORAGE_CLEANUP_PROVIDER === 'r2' ? 'r2' : 'supabase'
  const bucket = process.env.STORAGE_CLEANUP_BUCKET || 'albums'
  const prefix = process.env.STORAGE_CLEANUP_PREFIX || ''

  const url = `${siteUrl}/api/storage/cleanup-orphan`

  console.log('[storage-cleanup-cron] calling:', url)
  console.log('[storage-cleanup-cron] dryRun:', dryRun)
  console.log('[storage-cleanup-cron] limit:', limit)
  console.log('[storage-cleanup-cron] provider:', provider)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret,
    },
    body: JSON.stringify({
      dryRun,
      limit,
      scanLimit,
      provider,
      bucket,
      prefix,
    }),
  })

  const text = await res.text()

  console.log('[storage-cleanup-cron] status:', res.status)
  console.log('[storage-cleanup-cron] response:', text.slice(0, 500))

  if (!res.ok) {
    process.exit(1)
  }

  const data = JSON.parse(text)

  console.log(
    '[storage-cleanup-cron] json:',
    JSON.stringify(data, null, 2)
  )

  if (!dryRun && Number(data.deletedCount || 0) > limit) {
    throw new Error('Deleted count exceeded limit')
  }
}

main().catch((error) => {
  console.error('[storage-cleanup-cron] fatal:', error)
  process.exit(1)
})
