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

export async function POST() {
  try {
    const supabase = getSupabaseAdmin()

    const logsBefore = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString()

    const heartbeatBefore = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString()

    const jobsBefore = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000
    ).toISOString()

    const [
      logsCleanup,
      heartbeatCleanup,
      photoJobsCleanup,
      faceJobsCleanup,
    ] = await Promise.all([
      supabase
        .from('worker_logs')
        .delete()
        .lt('created_at', logsBefore),

      supabase
        .from('worker_heartbeats')
        .delete()
        .lt('last_seen_at', heartbeatBefore),

      supabase
        .from('photo_jobs')
        .delete()
        .eq('status', 'done')
        .lt('finished_at', jobsBefore),

      supabase
        .from('face_jobs')
        .delete()
        .eq('status', 'done')
        .lt('finished_at', jobsBefore),
    ])

    return NextResponse.json({
      success: true,
      cleanedAt: new Date().toISOString(),
      results: {
        workerLogs: !logsCleanup.error,
        workerHeartbeats: !heartbeatCleanup.error,
        photoJobs: !photoJobsCleanup.error,
        faceJobs: !faceJobsCleanup.error,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Cleanup failed',
      },
      {
        status: 500,
      }
    )
  }
}