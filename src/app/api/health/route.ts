import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getRuntimeStatus(lastSeenAt?: string | null) {
  if (!lastSeenAt) return 'offline'

  const diffMs = Date.now() - new Date(lastSeenAt).getTime()
  return diffMs > 2 * 60 * 1000 ? 'offline' : 'online'
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function isAuthorizedHealthRequest(req: Request) {
  const adminSecret = String(process.env.ADMIN_API_SECRET || '').trim()
  const workerSecret = String(process.env.WORKER_SECRET || '').trim()

  const requestSecret = String(
    req.headers.get('x-admin-secret') ||
      req.headers.get('x-worker-secret') ||
      ''
  ).trim()

  if (!requestSecret) return false

  return (
    (adminSecret && requestSecret === adminSecret) ||
    (workerSecret && requestSecret === workerSecret)
  )
}

async function countStatus(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'photo_jobs' | 'face_jobs',
  status: string
) {
  const { count, error } = await supabase
    .from(table)
    .select('id', {
      count: 'exact',
      head: true,
    })
    .eq('status', status)

  if (error) {
    return {
      ok: false,
      count: 0,
      error: error.message,
    }
  }

  return {
    ok: true,
    count: count || 0,
    error: null,
  }
}

async function getWorkerHealth(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  workerType: 'photo' | 'face'
) {
  const staleSince = new Date(Date.now() - 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('worker_heartbeats')
    .select('worker_name, worker_type, status, last_seen_at, metadata')
    .eq('worker_type', workerType)
    .gte('last_seen_at', staleSince)
    .order('last_seen_at', { ascending: false })

  if (error) {
    return {
      ok: false,
      online: 0,
      workers: [],
      error: error.message,
    }
  }

  const workers = (data || []).map((row) => ({
  ...row,
  runtime_status: getRuntimeStatus(row.last_seen_at || null),
}))

const onlineWorkers = workers.filter(
  (worker) => worker.runtime_status === 'online'
)

return {
  ok: onlineWorkers.length > 0,
  online: onlineWorkers.length,
  workers,
  error: null,
}
}

export async function GET(req: Request) {
  const startedAt = Date.now()

  const authorized = isAuthorizedHealthRequest(req)

if (!authorized) {
  return NextResponse.json({
    success: true,
    status: 'ok',
    service: 'ciiya',
    checkedAt: new Date().toISOString(),
  })
}

  try {
    const supabase = getSupabaseAdmin()

    const [
      photoPending,
      photoProcessing,
      photoFailed,
      facePending,
      faceProcessing,
      faceFailed,
      photoWorker,
      faceWorker,
    ] = await Promise.all([
      countStatus(supabase, 'photo_jobs', 'pending'),
      countStatus(supabase, 'photo_jobs', 'processing'),
      countStatus(supabase, 'photo_jobs', 'failed'),
      countStatus(supabase, 'face_jobs', 'pending'),
      countStatus(supabase, 'face_jobs', 'processing'),
      countStatus(supabase, 'face_jobs', 'failed'),
      getWorkerHealth(supabase, 'photo'),
      getWorkerHealth(supabase, 'face'),
    ])

    const dbOk =
      photoPending.ok &&
      photoProcessing.ok &&
      photoFailed.ok &&
      facePending.ok &&
      faceProcessing.ok &&
      faceFailed.ok &&
      !photoWorker.error &&
      !faceWorker.error

    const photoQueueHealthy = photoFailed.count === 0
    const faceQueueHealthy = faceFailed.count === 0

    const workersHealthy = photoWorker.ok && faceWorker.ok

    const overallHealthy =
      dbOk && photoQueueHealthy && faceQueueHealthy && workersHealthy

    return NextResponse.json({
      success: true,
      status: overallHealthy ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      services: {
        web: {
          ok: true,
        },
        database: {
          ok: dbOk,
        },
        photoWorker: {
          ok: photoWorker.ok,
          online: photoWorker.online,
          workers: photoWorker.workers,
          error: photoWorker.error,
        },
        faceWorker: {
          ok: faceWorker.ok,
          online: faceWorker.online,
          workers: faceWorker.workers,
          error: faceWorker.error,
        },
        photoQueue: {
          ok: photoQueueHealthy,
          pending: photoPending.count,
          processing: photoProcessing.count,
          failed: photoFailed.count,
        },
        faceQueue: {
          ok: faceQueueHealthy,
          pending: facePending.count,
          processing: faceProcessing.count,
          failed: faceFailed.count,
        },
      },
    })
  } catch (error) {
    console.error('[health] failed:', error)
    
    return NextResponse.json(
      {
        success: false,
        status: 'down',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        error: 'Health check failed',
      },
      { status: 500 }
    )
  }
}