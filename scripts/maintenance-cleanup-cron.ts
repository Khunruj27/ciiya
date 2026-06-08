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

  const dryRun = getBooleanEnv('MAINTENANCE_CLEANUP_DRY_RUN', true)
  const keepLogDays = getNumberEnv('MAINTENANCE_LOG_KEEP_DAYS', 14)
  const keepHeartbeatHours = getNumberEnv(
    'MAINTENANCE_HEARTBEAT_KEEP_HOURS',
    24
  )
  const limit = getNumberEnv('MAINTENANCE_CLEANUP_LIMIT', 100)

  const url = `${siteUrl}/api/admin/maintenance-cleanup`

  console.log('[maintenance-cleanup-cron] calling:', url)
  console.log('[maintenance-cleanup-cron] dryRun:', dryRun)
  console.log('[maintenance-cleanup-cron] keepLogDays:', keepLogDays)
  console.log(
    '[maintenance-cleanup-cron] keepHeartbeatHours:',
    keepHeartbeatHours
  )
  console.log('[maintenance-cleanup-cron] limit:', limit)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret,
    },
    body: JSON.stringify({
      dryRun,
      keepLogDays,
      keepHeartbeatHours,
      limit,
    }),
  })

  const text = await res.text()

  console.log('[maintenance-cleanup-cron] status:', res.status)
  console.log('[maintenance-cleanup-cron] response:', text.slice(0, 800))

  if (!res.ok) {
    process.exit(1)
  }

  const data = JSON.parse(text)

  console.log(
    '[maintenance-cleanup-cron] json:',
    JSON.stringify(data, null, 2)
  )
}

main().catch((error) => {
  console.error('[maintenance-cleanup-cron] fatal:', error)
  process.exit(1)
})