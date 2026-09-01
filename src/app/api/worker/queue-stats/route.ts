import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getRuntimeStatus(lastSeenAt?: string | null) {
  if (!lastSeenAt) return 'offline'

  const diffMs = Date.now() - new Date(lastSeenAt).getTime()
  return diffMs > 2 * 60 * 1000 ? 'offline' : 'online'
}

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function requireAdmin() {
  if (process.env.NODE_ENV === 'development') {
    return {
      ok: true,
      status: 200,
      error: null,
    }
  }

  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
    }
  }

  const adminEmails = getAdminEmails()
  const isAdmin = adminEmails.includes(user.email.toLowerCase())

  if (!isAdmin) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden',
    }
  }

  return {
    ok: true,
    status: 200,
    error: null,
  }
}

async function getRecentJobs(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'photo_jobs' | 'face_jobs'
) {
  const { data, error } = await supabase
    .from(table)
    .select(
      `
      id,
      photo_id,
      album_id,
      status,
      progress,
      retry_count,
      error,
      created_at,
      started_at,
      finished_at
      `
    )
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error(`[queue-stats] recent ${table}:`, error.message)
    return []
  }

  return data || []
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

function averageSeconds(
  rows: {
    created_at?: string | null
    started_at?: string | null
    finished_at?: string | null
    updated_at?: string | null
  }[]
) {
  const durations = rows
    .map((row) => {
      const start = row.started_at || row.created_at
      const end = row.finished_at || row.updated_at

      if (!start || !end) return null

      const startTime = new Date(start).getTime()
      const endTime = new Date(end).getTime()

      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
        return null
      }

      const diff = Math.max(0, endTime - startTime)

      return diff / 1000
    })
    .filter((value): value is number => typeof value === 'number')

  if (durations.length === 0) return null

  return Number(
    (durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(2)
  )
}

async function getPerformanceAnalytics(
  supabase: ReturnType<typeof getSupabaseAdmin>
) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const [photoResult, faceResult, cameraResult] = await Promise.all([
    supabase
      .from('photo_jobs')
      .select('created_at, started_at, finished_at, updated_at')
      .eq('status', 'done')
      .gte('created_at', since)
      .limit(200),

    supabase
      .from('face_jobs')
      .select('created_at, started_at, finished_at, updated_at')
      .eq('status', 'done')
      .gte('created_at', since)
      .limit(200),

    supabase
      .from('camera_live_imports')
      .select('created_at, imported_at, uploaded_at, updated_at')
      .eq('status', 'done')
      .gte('created_at', since)
      .limit(200),
  ])

  const photoRows = photoResult.data || []
  const faceRows = faceResult.data || []
  const cameraRows = (cameraResult.data || []).map((row) => ({
    created_at: row.created_at,
    started_at: row.imported_at || row.created_at,
    finished_at: row.uploaded_at || row.updated_at,
    updated_at: row.updated_at,
  }))

  const totalDone =
    photoRows.length + faceRows.length + cameraRows.length

  return {
    windowMinutes: 60,
    photoAvgSeconds: averageSeconds(photoRows),
    faceAvgSeconds: averageSeconds(faceRows),
    cameraAvgSeconds: averageSeconds(cameraRows),
    totalDone,
    throughputPerMinute: Number((totalDone / 60).toFixed(2)),
  }
}

async function getUploadRecoveryWatch(
  supabase: ReturnType<typeof getSupabaseAdmin>
) {
  const stuckAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const [stuckPhotosResult, stuckJobsResult, failedPhotosResult] =
    await Promise.all([
      supabase
        .from('photos')
        .select('id, album_id, filename, processing_status, processing_progress, created_at, updated_at')
        .in('processing_status', ['pending', 'processing'])
        .lt('updated_at', stuckAt)
        .order('updated_at', { ascending: true })
        .limit(20),

      supabase
        .from('photo_jobs')
        .select('id, photo_id, album_id, status, progress, retry_count, error, created_at, started_at, updated_at')
        .in('status', ['pending', 'processing'])
        .lt('updated_at', stuckAt)
        .order('updated_at', { ascending: true })
        .limit(20),

      supabase
        .from('photos')
        .select('id, album_id, filename, processing_status, processing_progress, created_at, updated_at')
        .eq('processing_status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(20),
    ])

  return {
    stuckMinutes: 10,
    stuckPhotos: stuckPhotosResult.data || [],
    stuckJobs: stuckJobsResult.data || [],
    failedPhotos: failedPhotosResult.data || [],
  }
}

async function countByStatus(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'photo_jobs' | 'face_jobs' | 'camera_live_imports',
  statuses = ['pending', 'processing', 'done', 'failed']
) {

  const results = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await supabase
        .from(table)
        .select('id', {
          count: 'exact',
          head: true,
        })
        .eq('status', status)

      if (error) {
        console.error(`[queue-stats] ${table}.${status}:`, error.message)

        return {
          status,
          count: 0,
        }
      }

      return {
        status,
        count: count || 0,
      }
    })
  )

  return results.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = item.count
    return acc
  }, {})
}

async function getWorkers(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data, error } = await supabase
    .from('worker_heartbeats')
    .select(`
      worker_id,
      worker_name,
      worker_type,
      status,
      last_seen,
      last_seen_at,
      metadata
    `)
    .order('last_seen_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[queue-stats] workers:', error.message)
    return []
  }

  return (data || []).map((row) => {
    const lastSeenAt = row.last_seen_at || row.last_seen || null
    const runtimeStatus = getRuntimeStatus(lastSeenAt)

    return {
      ...row,
      runtime_status: runtimeStatus,
      is_online: runtimeStatus === 'online',
    }
  })
}

async function getRecentErrors(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data, error } = await supabase
    .from('worker_logs')
    .select(
      `
      id,
      worker_type,
      level,
      message,
      photo_id,
      album_id,
      created_at
      `
    )
    .eq('level', 'error')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[queue-stats] recent errors:', error.message)
    return []
  }

  return data || []
}

async function getFailedJobs(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'photo_jobs' | 'face_jobs'
) {
  const { data, error } = await supabase
    .from(table)
    .select(
      `
      id,
      photo_id,
      album_id,
      status,
      retry_count,
      error,
      created_at,
      started_at,
      finished_at
      `
    )
    .eq('status', 'failed')
    .order('finished_at', {
      ascending: false,
      nullsFirst: false,
    })
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error(`[queue-stats] failed ${table}:`, error.message)
    return []
  }

  return data || []
}

async function getRecentCameraImports(
  supabase: ReturnType<typeof getSupabaseAdmin>
) {
  const { data, error } = await supabase
    .from('camera_live_imports')
    .select(
      `
      id,
      album_id,
      filename,
      status,
      progress,
      error,
      created_at,
      updated_at
      `
    )
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('[queue-stats] recent camera imports:', error.message)
    return []
  }

  return data || []
}


async function getRecentTimeline(
  supabase: ReturnType<typeof getSupabaseAdmin>
) {
  const { data, error } = await supabase
    .from('worker_logs')
    .select(
      `
      id,
      worker_type,
      level,
      message,
      photo_id,
      album_id,
      created_at
      `
    )
    .order('created_at', {
      ascending: false,
    })
    .limit(20)

  if (error) {
    console.error('[queue-stats] recent timeline:', error.message)
    return []
  }

  return data || []
}

export async function GET() {
  try {
    const admin = await requireAdmin()

    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.error },
        { status: admin.status }
      )
    }

    const supabase = getSupabaseAdmin()

  const [
  photoJobs,
  faceJobs,
  cameraJobs,
  workers,
  recentErrors,
  failedPhotoJobs,
  failedFaceJobs,
  recentCameraImports,
  recentPhotoJobs,
  recentFaceJobs,
  recentTimeline,
  performanceAnalytics,
  uploadRecoveryWatch,
] = await Promise.all([
  countByStatus(supabase, 'photo_jobs'),
  countByStatus(supabase, 'face_jobs'),
  countByStatus(supabase, 'camera_live_imports', [
    'pending',
    'imported',
    'uploading',
    'finalizing',
    'done',
    'failed',
  ]),
  getWorkers(supabase),
  getRecentErrors(supabase),
  getFailedJobs(supabase, 'photo_jobs'),
  getFailedJobs(supabase, 'face_jobs'),
  getRecentCameraImports(supabase),
  getRecentJobs(supabase, 'photo_jobs'),
  getRecentJobs(supabase, 'face_jobs'),
  getRecentTimeline(supabase),
  getPerformanceAnalytics(supabase),
  getUploadRecoveryWatch(supabase),
])

return NextResponse.json({
  success: true,

  photoJobs,
  faceJobs,
  cameraJobs,

  workers,
  onlineWorkers: workers.filter(
    (worker) => worker.runtime_status === 'online'
  ).length,
  offlineWorkers: workers.filter(
    (worker) => worker.runtime_status === 'offline'
  ).length,

  recentErrors,
  failedPhotoJobs,
  failedFaceJobs,
  recentCameraImports,

  recentPhotoJobs,
  recentFaceJobs,
  recentTimeline,
  performanceAnalytics,
  uploadRecoveryWatch,

  checkedAt: new Date().toISOString(),
})
  } catch (error) {
    console.error('[queue-stats] fatal:', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Queue stats failed',
      },
      { status: 500 }
    )
  }
}