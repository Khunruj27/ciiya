import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET

  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '').trim()

  return token === secret
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

async function resetStuckJobs(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const photoStaleSince = minutesAgo(15)
  const faceStaleSince = minutesAgo(25)

  const { data: photoJobs, error: photoError } = await supabase
    .from('photo_jobs')
    .update({
      status: 'pending',
      progress: 0,
      started_at: null,
      finished_at: null,
      error: 'Auto reset stale photo job',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'processing')
    .lt('started_at', photoStaleSince)
    .select('id')

  if (photoError) throw new Error(photoError.message)

  const { data: faceJobs, error: faceError } = await supabase
    .from('face_jobs')
    .update({
      status: 'pending',
      progress: 0,
      started_at: null,
      finished_at: null,
      error: 'Auto reset stale face job',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'processing')
    .lt('started_at', faceStaleSince)
    .select('id')

  if (faceError) throw new Error(faceError.message)

  return {
    photo: photoJobs?.length || 0,
    face: faceJobs?.length || 0,
  }
}

async function retryFailedJobs(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data: photoJobs } = await supabase
    .from('photo_jobs')
    .select('id, photo_id')
    .eq('status', 'failed')
    .lt('retry_count', 3)
    .order('updated_at', { ascending: true })
    .limit(50)

  const photoIds = (photoJobs || []).map((job) => job.id)
  const affectedPhotoIds = (photoJobs || [])
    .map((job) => job.photo_id)
    .filter(Boolean)

  if (photoIds.length > 0) {
    await supabase
      .from('photo_jobs')
      .update({
        status: 'pending',
        progress: 0,
        started_at: null,
        finished_at: null,
        error: 'Auto retry failed photo job',
        updated_at: new Date().toISOString(),
      })
      .in('id', photoIds)

    if (affectedPhotoIds.length > 0) {
      await supabase
        .from('photos')
        .update({
          processing_status: 'pending',
          processing_progress: 0,
          updated_at: new Date().toISOString(),
        })
        .in('id', affectedPhotoIds)
    }
  }

  const { data: faceJobs } = await supabase
    .from('face_jobs')
    .select('id, photo_id')
    .eq('status', 'failed')
    .lt('retry_count', 3)
    .order('updated_at', { ascending: true })
    .limit(50)

  const faceIds = (faceJobs || []).map((job) => job.id)
  const affectedFacePhotoIds = (faceJobs || [])
    .map((job) => job.photo_id)
    .filter(Boolean)

  if (faceIds.length > 0) {
    await supabase
      .from('face_jobs')
      .update({
        status: 'pending',
        progress: 0,
        started_at: null,
        finished_at: null,
        error: 'Auto retry failed face job',
        updated_at: new Date().toISOString(),
      })
      .in('id', faceIds)

    if (affectedFacePhotoIds.length > 0) {
      await supabase
        .from('photos')
        .update({
          face_scan_status: 'pending',
          face_scan_progress: 0,
          face_scan_error: null,
          updated_at: new Date().toISOString(),
        })
        .in('id', affectedFacePhotoIds)
    }
  }

  return {
    photo: photoIds.length,
    face: faceIds.length,
  }
}

async function cleanupOldJobs(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const doneCutoff = daysAgo(14)
  const failedCutoff = daysAgo(45)
  const logsCutoff = daysAgo(30)

  const { error: photoDoneError } = await supabase
    .from('photo_jobs')
    .delete()
    .eq('status', 'done')
    .lt('created_at', doneCutoff)

  if (photoDoneError) throw new Error(photoDoneError.message)

  const { error: faceDoneError } = await supabase
    .from('face_jobs')
    .delete()
    .eq('status', 'done')
    .lt('created_at', doneCutoff)

  if (faceDoneError) throw new Error(faceDoneError.message)

  const { error: photoFailedError } = await supabase
    .from('photo_jobs')
    .delete()
    .eq('status', 'failed')
    .lt('created_at', failedCutoff)

  if (photoFailedError) throw new Error(photoFailedError.message)

  const { error: faceFailedError } = await supabase
    .from('face_jobs')
    .delete()
    .eq('status', 'failed')
    .lt('created_at', failedCutoff)

  if (faceFailedError) throw new Error(faceFailedError.message)

  const { error: logsError } = await supabase
    .from('worker_logs')
    .delete()
    .lt('created_at', logsCutoff)

  if (logsError) throw new Error(logsError.message)

  return true
}

async function getQueueSummary(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const [photoPending, photoProcessing, photoFailed, facePending, faceProcessing, faceFailed] =
    await Promise.all([
      supabase.from('photo_jobs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('photo_jobs').select('id', { count: 'exact', head: true }).eq('status', 'processing'),
      supabase.from('photo_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      supabase.from('face_jobs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('face_jobs').select('id', { count: 'exact', head: true }).eq('status', 'processing'),
      supabase.from('face_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    ])

  return {
    photoJobs: {
      pending: photoPending.count || 0,
      processing: photoProcessing.count || 0,
      failed: photoFailed.count || 0,
    },
    faceJobs: {
      pending: facePending.count || 0,
      processing: faceProcessing.count || 0,
      failed: faceFailed.count || 0,
    },
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()

    const reset = await resetStuckJobs(supabase)
    const retry = await retryFailedJobs(supabase)
    await cleanupOldJobs(supabase)

    await supabase.from('worker_logs').insert({
      worker_type: 'cron',
      level: 'info',
      message: 'Auto maintenance completed',
      metadata: {
        reset,
        retry,
      },
    })

    const summary = await getQueueSummary(supabase)

    return NextResponse.json({
      success: true,
      mode: 'maintenance',
      reset,
      retry,
      summary,
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron/maintenance] fatal:', error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Maintenance cron failed',
      },
      { status: 500 }
    )
  }
}