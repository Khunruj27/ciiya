import dotenv from 'dotenv'

dotenv.config({
  path: '.env.local',
})

async function main() {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'

  const workerSecret = process.env.WORKER_SECRET || ''

  const url = `${siteUrl}/api/storage/cleanup-orphan`

  console.log('[storage-cleanup-cron] calling:', url)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret,
    },
    body: JSON.stringify({
      dryRun: true,
    }),
  })

  const text = await res.text()

  console.log('[storage-cleanup-cron] status:', res.status)
  console.log('[storage-cleanup-cron] response:', text.slice(0, 500))

  if (!res.ok) {
    process.exit(1)
  }

  try {
    const data = JSON.parse(text)
    console.log('[storage-cleanup-cron] json:', JSON.stringify(data, null, 2))
  } catch {
    throw new Error('Cleanup API did not return JSON')
  }
}

main().catch((error) => {
  console.error('[storage-cleanup-cron] fatal:', error)
  process.exit(1)
})