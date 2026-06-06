import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CleanupSummary = {
  dryRun: boolean
  limit: number
  failedPhotos: number
  deletedPhotoFiles: number
  deletedPhotos: number
  failedPhotoJobs: number
  donePhotoJobs: number
  failedFaceJobs: number
  doneFaceJobs: number
  oldWorkerLogs: number
  oldCameraLiveImports: number
  oldCameraUploadSessions: number
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function isAuthorized(req: NextRequest) {
  const workerSecret = process.env.WORKER_SECRET

  if (!workerSecret) {
    return process.env.NODE_ENV !== 'production'
  }

  const authHeader = req.headers.get('authorization')
  const workerHeader = req.headers.get('x-worker-secret')

  return (
    authHeader === `Bearer ${workerSecret}` ||
    workerHeader === workerSecret
  )
}

function getBooleanParam(req: NextRequest, key: string, fallback: boolean) {
  const value = req.nextUrl.searchParams.get(key)

  if (value === 'true') return true
  if (value === 'false') return false

  return fallback
}

function getNumberParam(req: NextRequest, key: string, fallback: number) {
  const value = Number(req.nextUrl.searchParams.get(key))

  if (!Number.isFinite(value) || value <= 0) return fallback

  return Math.min(value, 500)
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function compactPaths(paths: Array<string | null | undefined>) {
  return paths.filter((path): path is string => Boolean(path))
}

async function deleteRowsByIds(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  ids: string[],
  dryRun: boolean
) {
  if (ids.length === 0) return 0
  if (dryRun) return ids.length

  const { error } = await supabase.from(table).delete().in('id', ids)

  if (error) {
    throw new Error(`[cleanup] delete ${table}: ${error.message}`)
  }

  return ids.length
}

async function cleanupFailedPhotos(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  dryRun: boolean
  limit: number
}) {
  const { supabase, dryRun, limit } = params

  const before = daysAgo(1)

  const { data, error } = await supabase
    .from('photos')
    .select(
      `
      id,
      storage_path,
      original_path,
      preview_path,
      thumbnail_path,
      processing_status,
      created_at
      `
    )
    .eq('processing_status', 'failed')
    .lt('created_at', before)
    .limit(limit)

  if (error) {
    throw new Error(`[cleanup] failed photos: ${error.message}`)
  }

  const photos = data || []
  let deletedPhotoFiles = 0
  let deletedPhotos = 0

  for (const photo of photos) {
    const paths = compactPaths([
      photo.storage_path,
      photo.original_path,
      photo.preview_path,
      photo.thumbnail_path,
    ])

    if (paths.length > 0) {
      if (dryRun) {
        deletedPhotoFiles += paths.length
      } else {
        const { error: storageError } = await supabase.storage
          .from('albums')
          .remove(paths)

        if (!storageError) {
          deletedPhotoFiles += paths.length
        } else {
          console.warn(
            `[cleanup] storage remove skipped photo=${photo.id}:`,
            storageError.message
          )
        }
      }
    }

    if (!dryRun) {
      await supabase.from('photo_jobs').delete().eq('photo_id', photo.id)
      await supabase.from('face_jobs').delete().eq('photo_id', photo.id)

      const { error: photoDeleteError } = await supabase
        .from('photos')
        .delete()
        .eq('id', photo.id)

      if (photoDeleteError) {
        console.warn(
          `[cleanup] photo delete skipped photo=${photo.id}:`,
          photoDeleteError.message
        )
      } else {
        deletedPhotos++
      }
    } else {
      deletedPhotos++
    }
  }

  return {
    failedPhotos: photos.length,
    deletedPhotoFiles,
    deletedPhotos,
  }
}

async function cleanupJobs(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  table: 'photo_jobs' | 'face_jobs'
  status: 'done' | 'failed'
  olderThanDays: number
  limit: number
  dryRun: boolean
}) {
  const { supabase, table, status, olderThanDays, limit, dryRun } = params

  const before = daysAgo(olderThanDays)

  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('status', status)
    .lt('finished_at', before)
    .limit(limit)

  if (error) {
    throw new Error(`[cleanup] ${table}.${status}: ${error.message}`)
  }

  const ids = (data || []).map((row) => row.id)

  return deleteRowsByIds(supabase, table, ids, dryRun)
}

async function cleanupWorkerLogs(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  olderThanDays: number
  limit: number
  dryRun: boolean
}) {
  const { supabase, olderThanDays, limit, dryRun } = params

  const before = daysAgo(olderThanDays)

  const { data, error } = await supabase
    .from('worker_logs')
    .select('id')
    .lt('created_at', before)
    .limit(limit)

  if (error) {
    throw new Error(`[cleanup] worker_logs: ${error.message}`)
  }

  const ids = (data || []).map((row) => row.id)

  return deleteRowsByIds(supabase, 'worker_logs', ids, dryRun)
}

async function cleanupCameraLiveImports(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  olderThanDays: number
  limit: number
  dryRun: boolean
}) {
  const { supabase, olderThanDays, limit, dryRun } = params

  const before = daysAgo(olderThanDays)

  const { data, error } = await supabase
    .from('camera_live_imports')
    .select('id')
    .in('status', ['done', 'failed'])
    .lt('updated_at', before)
    .limit(limit)

  if (error) {
    throw new Error(`[cleanup] camera_live_imports: ${error.message}`)
  }

  const ids = (data || []).map((row) => row.id)

  return deleteRowsByIds(supabase, 'camera_live_imports', ids, dryRun)
}

async function cleanupCameraUploadSessions(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  olderThanDays: number
  limit: number
  dryRun: boolean
}) {
  const { supabase, olderThanDays, limit, dryRun } = params

  const before = daysAgo(olderThanDays)

  const { data, error } = await supabase
    .from('camera_upload_sessions')
    .select('id')
    .in('status', ['stopped', 'failed'])
    .lt('updated_at', before)
    .limit(limit)

  if (error) {
    throw new Error(`[cleanup] camera_upload_sessions: ${error.message}`)
  }

  const ids = (data || []).map((row) => row.id)

  return deleteRowsByIds(supabase, 'camera_upload_sessions', ids, dryRun)
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()

    const dryRun = getBooleanParam(
      req,
      'dryRun',
      process.env.CLEANUP_DRY_RUN !== 'false'
    )

    const limit = getNumberParam(
      req,
      'limit',
      Number(process.env.CLEANUP_DELETE_CHUNK_SIZE || 100)
    )

    const failedPhotosResult = await cleanupFailedPhotos({
      supabase,
      dryRun,
      limit,
    })

    const failedPhotoJobs = await cleanupJobs({
      supabase,
      table: 'photo_jobs',
      status: 'failed',
      olderThanDays: Number(
        process.env.CLEANUP_FAILED_JOBS_RETENTION_DAYS || 45
      ),
      limit,
      dryRun,
    })

    const donePhotoJobs = await cleanupJobs({
      supabase,
      table: 'photo_jobs',
      status: 'done',
      olderThanDays: Number(
        process.env.CLEANUP_DONE_JOBS_RETENTION_DAYS || 14
      ),
      limit,
      dryRun,
    })

    const failedFaceJobs = await cleanupJobs({
      supabase,
      table: 'face_jobs',
      status: 'failed',
      olderThanDays: Number(
        process.env.CLEANUP_FAILED_JOBS_RETENTION_DAYS || 45
      ),
      limit,
      dryRun,
    })

    const doneFaceJobs = await cleanupJobs({
      supabase,
      table: 'face_jobs',
      status: 'done',
      olderThanDays: Number(
        process.env.CLEANUP_DONE_JOBS_RETENTION_DAYS || 14
      ),
      limit,
      dryRun,
    })

    const oldWorkerLogs = await cleanupWorkerLogs({
      supabase,
      olderThanDays: Number(
        process.env.CLEANUP_WORKER_LOGS_RETENTION_DAYS || 30
      ),
      limit,
      dryRun,
    })

    const oldCameraLiveImports = await cleanupCameraLiveImports({
      supabase,
      olderThanDays: 14,
      limit,
      dryRun,
    })

    const oldCameraUploadSessions = await cleanupCameraUploadSessions({
      supabase,
      olderThanDays: 14,
      limit,
      dryRun,
    })

    const summary: CleanupSummary = {
      dryRun,
      limit,
      ...failedPhotosResult,
      failedPhotoJobs,
      donePhotoJobs,
      failedFaceJobs,
      doneFaceJobs,
      oldWorkerLogs,
      oldCameraLiveImports,
      oldCameraUploadSessions,
    }

    return NextResponse.json({
      success: true,
      summary,
      message: dryRun
        ? 'Cleanup dry run completed'
        : 'Cleanup completed',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Cleanup failed',
      },
      { status: 500 }
    )
  }
}