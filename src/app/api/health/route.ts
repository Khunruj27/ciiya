import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    .select('worker_name, worker_type, status, last_seen_at, meta')
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

  return {
    ok: (data?.length || 0) > 0,
    online: data?.length || 0,
    workers: data || [],
    error: null,
  }
}

export async function GET() {
  const startedAt = Date.now()

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
    return NextResponse.json(
      {
        success: false,
        status: 'down',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'Health check failed',
      },
      { status: 500 }
    )
  }
}