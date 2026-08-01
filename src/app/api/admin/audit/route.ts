import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function requireAdmin() {
  if (process.env.NODE_ENV === 'development') return true

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) return false

  return getAdminEmails().includes(user.email.toLowerCase())
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) throw new Error('Missing Supabase admin env')

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function countByStatus<T extends { status?: string | null }>(rows: T[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const status = row.status || 'unknown'
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})
}

function isWorkerOnline(value?: string | null) {
  if (!value) return false

  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return false

  return Date.now() - time <= 5 * 60 * 1000
}

export async function GET() {
  try {
    const isAdmin = await requireAdmin()

    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()
    const stuckAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const [
      photosResult,
      photoJobsResult,
      faceJobsResult,
      cameraImportsResult,
      cameraSessionsResult,
      workersResult,
      storageResult,
      logsResult,
    ] = await Promise.all([
      supabase
        .from('photos')
        .select(
          'id, album_id, owner_id, file_hash, processing_status, processing_progress, created_at, updated_at'
        )
        .limit(5000),

      supabase
        .from('photo_jobs')
        .select(
        'id, photo_id, album_id, owner_id, status, retry_count, error, created_at, started_at, finished_at, updated_at'
        )
        .limit(5000),

      supabase
        .from('face_jobs')
        .select(
        'id, photo_id, album_id, owner_id, status, retry_count, error, created_at, started_at, finished_at, updated_at'
        )
        .limit(5000),

      supabase
        .from('camera_live_imports')
        .select(
          'id, session_id, album_id, owner_id, filename, status, progress, error, created_at, updated_at'
        )
        .limit(5000),

      supabase
        .from('camera_upload_sessions')
        .select(
          'id, album_id, owner_id, status, created_at, updated_at, last_activity_at'
        )
        .limit(1000),

      supabase
        .from('worker_heartbeats')
        .select(
          'worker_id, worker_name, worker_type, status, last_seen, last_seen_at, updated_at'
        )
        .limit(100),

      supabase
        .from('user_storage_usage')
        .select(
          'user_id, current_plan, used_bytes, storage_used_bytes, storage_limit_bytes, photo_count, photos_count, albums_count, updated_at'
        )
        .limit(5000),

      supabase
        .from('worker_logs')
        .select('id, worker_type, level, message, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    const photos = photosResult.data || []
    const photoJobs = photoJobsResult.data || []
    const faceJobs = faceJobsResult.data || []
    const cameraImports = cameraImportsResult.data || []
    const cameraSessions = cameraSessionsResult.data || []
    const workers = workersResult.data || []
    const storageRows = storageResult.data || []

    const topStorageUsers = [...storageRows]
  .sort(
    (a, b) =>
      Number(b.storage_used_bytes || b.used_bytes || 0) -
      Number(a.storage_used_bytes || a.used_bytes || 0)
  )
  .slice(0, 10)

const totalStorageUsed = storageRows.reduce(
  (sum, row) =>
    sum + Number(row.storage_used_bytes || row.used_bytes || 0),
  0
)

const totalStorageLimit = storageRows.reduce(
  (sum, row) =>
    sum + Number(row.storage_limit_bytes || 0),
  0
)

const averageStorage =
  storageRows.length > 0
    ? Math.round(totalStorageUsed / storageRows.length)
    : 0
    
    const logs = logsResult.data || []

    const photoJobStatus = countByStatus(photoJobs)
    const faceJobStatus = countByStatus(faceJobs)
    const cameraImportStatus = countByStatus(cameraImports)

    const onlineWorkers = workers.filter((worker) =>
      isWorkerOnline(worker.last_seen_at || worker.last_seen || worker.updated_at)
    )

    const stuckPhotos = photos.filter((photo) => {
      const status = String(photo.processing_status || '')
      const updatedAt = photo.updated_at || photo.created_at

      return (
        ['pending', 'processing'].includes(status) &&
        updatedAt &&
        String(updatedAt) < stuckAt
      )
    })

    const stuckPhotoJobs = photoJobs.filter((job) => {
      const status = String(job.status || '')
      const updatedAt = job.updated_at || job.started_at || job.created_at

      return (
        ['pending', 'processing'].includes(status) &&
        updatedAt &&
        String(updatedAt) < stuckAt
      )
    })

    const stuckFaceJobs = faceJobs.filter((job) => {
      const status = String(job.status || '')
      const updatedAt = job.updated_at || job.started_at || job.created_at

      return (
        ['pending', 'processing'].includes(status) &&
        updatedAt &&
        String(updatedAt) < stuckAt
      )
    })

    const storageWarningUsers = storageRows.filter((row) => {
      const used = Number(row.storage_used_bytes || row.used_bytes || 0)
      const limit = Number(row.storage_limit_bytes || 0)

      if (!limit || limit <= 0) return false

      const percent = (used / limit) * 100

      return percent >= 70 && percent < 90
    })

    const storageDangerUsers = storageRows.filter((row) => {
      const used = Number(row.storage_used_bytes || row.used_bytes || 0)
      const limit = Number(row.storage_limit_bytes || 0)

      if (!limit || limit <= 0) return false

      return (used / limit) * 100 >= 90
    })

    const hashMap = new Map<string, number>()

    photos.forEach((photo) => {
      const key = `${photo.album_id}:${photo.file_hash || ''}`

      if (!photo.album_id || !photo.file_hash) return

      hashMap.set(key, (hashMap.get(key) || 0) + 1)
    })

    const duplicateHashCount = Array.from(hashMap.values()).filter(
      (count) => count > 1
    ).length

    const photoIds = new Set(photos.map((photo) => photo.id))

    const jobsWithoutPhoto = photoJobs.filter(
      (job) => job.photo_id && !photoIds.has(job.photo_id)
    )

    const faceJobsWithoutPhoto = faceJobs.filter(
      (job) => job.photo_id && !photoIds.has(job.photo_id)
    )

    const failedLogs = logs.filter((log) =>
      ['error', 'fatal'].includes(String(log.level || '').toLowerCase())
    )

    const overallIssues =
      (photoJobStatus.failed || 0) +
      (faceJobStatus.failed || 0) +
      (cameraImportStatus.failed || 0) +
      stuckPhotos.length +
      stuckPhotoJobs.length +
      stuckFaceJobs.length +
      storageWarningUsers.length +
      storageDangerUsers.length +
      duplicateHashCount +
      jobsWithoutPhoto.length +
      faceJobsWithoutPhoto.length +
      failedLogs.length +
      Math.max(0, workers.length - onlineWorkers.length)

    function averageSeconds(
  rows: {
    started_at?: string | null
    finished_at?: string | null
  }[]
) {
  const values = rows
    .map((row) => {
      if (!row.started_at || !row.finished_at) return null

      const start = new Date(row.started_at).getTime()
      const end = new Date(row.finished_at).getTime()

      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null
      }

      return (end - start) / 1000
    })
    .filter((v): v is number => v !== null)

  if (!values.length) return 0

  return Number(
    (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)
  )
}

const completedPhotoJobs = photoJobs.filter(
  (job) => job.status === 'done'
)

const completedFaceJobs = faceJobs.filter(
  (job) => job.status === 'done'
)

const photoFailed = photoJobs.filter(
  (job) => job.status === 'failed'
).length

const faceFailed = faceJobs.filter(
  (job) => job.status === 'failed'
).length

const photoRetry = photoJobs.reduce(
  (sum, job) => sum + Number(job.retry_count || 0),
  0
)

const faceRetry = faceJobs.reduce(
  (sum, job) => sum + Number(job.retry_count || 0),
  0
)

const photoHealth = Math.max(
  0,
  Math.min(
    100,
    100 - photoFailed * 5 - Math.floor(photoRetry / 10)
  )
)

const faceHealth = Math.max(
  0,
  Math.min(
    100,
    100 - faceFailed * 5 - Math.floor(faceRetry / 10)
  )
)
const todayStart = new Date()
todayStart.setHours(0, 0, 0, 0)

const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

const todayPhotos = photos.filter((photo) => {
  if (!photo.created_at) return false
  return new Date(photo.created_at).getTime() >= todayStart.getTime()
})

const todayCameraImports = cameraImports.filter((item) => {
  if (!item.created_at) return false
  return new Date(item.created_at).getTime() >= todayStart.getTime()
})

const recentPhotoJobs = photoJobs.filter((job) => {
  if (!job.finished_at) return false
  return new Date(job.finished_at).getTime() >= oneHourAgo.getTime()
})

const recentFaceJobs = faceJobs.filter((job) => {
  if (!job.finished_at) return false
  return new Date(job.finished_at).getTime() >= oneHourAgo.getTime()
})

const getSlowJobs = (
  rows: {
    id: string
    photo_id?: string | null
    status?: string | null
    started_at?: string | null
    finished_at?: string | null
  }[],
  type: 'photo' | 'face'
) => {
  return rows
    .map((job) => {
      if (!job.started_at || !job.finished_at) return null

      const start = new Date(job.started_at).getTime()
      const end = new Date(job.finished_at).getTime()

      if (!Number.isFinite(start) || !Number.isFinite(end)) return null

      return {
        id: job.id,
        photoId: job.photo_id || null,
        type,
        seconds: Math.max(0, Math.round((end - start) / 1000)),
        status: job.status || 'unknown',
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 20)
}

const queueHeatmap = {
  photo: photoJobStatus,
  face: faceJobStatus,
  camera: cameraImportStatus,
}

const monitoring = {
  liveActivity: {
    photosToday: todayPhotos.length,
    cameraImportsToday: todayCameraImports.length,
    uploadsLastHour: photos.filter((photo) => {
      if (!photo.created_at) return false
      return new Date(photo.created_at).getTime() >= oneHourAgo.getTime()
    }).length,
    cameraImportsLastHour: cameraImports.filter((item) => {
      if (!item.created_at) return false
      return new Date(item.created_at).getTime() >= oneHourAgo.getTime()
    }).length,
  },
  throughput: {
    photoJobsLastHour: recentPhotoJobs.length,
    faceJobsLastHour: recentFaceJobs.length,
    totalJobsLastHour: recentPhotoJobs.length + recentFaceJobs.length,
  },
  slowJobs: [
    ...getSlowJobs(photoJobs, 'photo'),
    ...getSlowJobs(faceJobs, 'face'),
  ]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 20),
  queueHeatmap,
}

    return NextResponse.json({
      success: true,
      overall: {
        status: overallIssues === 0 ? 'healthy' : 'attention',
        issueCount: overallIssues,
      },
      upload: {
        photos: {
          total: photos.length,
          stuck: stuckPhotos.length,
          failed: photos.filter(
            (photo) => photo.processing_status === 'failed'
          ).length,
        },
        jobs: {
          total: photoJobs.length,
          byStatus: photoJobStatus,
          stuck: stuckPhotoJobs.length,
        },
      },
      face: {
        total: faceJobs.length,
        byStatus: faceJobStatus,
        stuck: stuckFaceJobs.length,
      },
     camera: {
  imports: {
    total: cameraImports.length,
    byStatus: cameraImportStatus,
  },
  sessions: {
    total: cameraSessions.length,
    active: cameraSessions.filter((session) => session.status === 'active')
      .length,
  },
},

monitoring,

workerPerformance: {
  photo: {
    completedJobs: completedPhotoJobs.length,
    failedJobs: photoFailed,
    retries: photoRetry,
    averageSeconds: averageSeconds(completedPhotoJobs),
    healthScore: photoHealth,
  },

  face: {
    completedJobs: completedFaceJobs.length,
    failedJobs: faceFailed,
    retries: faceRetry,
    averageSeconds: averageSeconds(completedFaceJobs),
    healthScore: faceHealth,
  },
},

      workers: {
        total: workers.length,
        online: onlineWorkers.length,
        offline: Math.max(0, workers.length - onlineWorkers.length),
        items: workers,
      },
      storage: {
        totalUsers: storageRows.length,
        warningUsers: storageWarningUsers.length,
        dangerUsers: storageDangerUsers.length,
      },
      dataIntegrity: {
        duplicateHashCount,
        jobsWithoutPhoto: jobsWithoutPhoto.length,
        faceJobsWithoutPhoto: faceJobsWithoutPhoto.length,
      },
      logs: {
        recentErrors: failedLogs.slice(0, 10),
      },
  
storageAnalytics: {
  totalUsers: storageRows.length,
  totalStorageUsed,
  totalStorageLimit,
  averageStorage,
  topUsers: topStorageUsers.map((item) => {
    const usedBytes = Number(item.storage_used_bytes || item.used_bytes || 0)
    const limitBytes = Number(item.storage_limit_bytes || 0)

    return {
      userId: item.user_id,
      usedBytes,
      limitBytes,
      percent:
        limitBytes > 0
          ? Math.round((usedBytes / limitBytes) * 100)
          : 0,
      plan: item.current_plan || 'free',
    }
  }),
},

checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Audit failed',
      },
      { status: 500 }
    )
  }
}