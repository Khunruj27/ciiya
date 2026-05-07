import 'dotenv/config'

const WORKER_URL =
  process.env.WORKER_API_URL ||
  `${process.env.NEXT_PUBLIC_SITE_URL}/api/worker/process-photos`

const WORKER_SECRET = process.env.WORKER_SECRET

const POLL_INTERVAL = Number(process.env.WORKER_POLL_INTERVAL || 3000)

if (!WORKER_URL) {
  throw new Error('Missing WORKER_API_URL or NEXT_PUBLIC_SITE_URL')
}

if (!WORKER_SECRET) {
  throw new Error('Missing WORKER_SECRET')
}

async function runWorker() {
  try {
    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Worker request failed:', data)
      return
    }

    if (data.processed > 0) {
      console.log(
        `[Worker] processed=${data.processed} concurrency=${data.concurrency}`
      )
    }
  } catch (error) {
    console.error('Worker polling error:', error)
  }
}

async function start() {
  console.log('Photo worker started')

  while (true) {
    await runWorker()

    await new Promise((resolve) =>
      setTimeout(resolve, POLL_INTERVAL)
    )
  }
}

start()