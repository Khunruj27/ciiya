import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteProps = {
  params: Promise<{
    id: string
  }>
}

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const email = user?.email?.trim().toLowerCase()

  if (!email) {
    return false
  }

  const adminEmails = getAdminEmails()

  if (adminEmails.length === 0) {
    console.error('[admin-user-detail] ADMIN_EMAILS is empty')
    return false
  }

  return adminEmails.includes(email)
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

function isActiveDate(value?: string | null) {
  if (!value) return false

  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return false

  return Date.now() - time <= 30 * 24 * 60 * 60 * 1000
}

function formatUserName(email?: string | null) {
  if (!email) return 'User'
  return email.split('@')[0] || 'User'
}

export async function GET(_req: Request, { params }: RouteProps) {
  try {
    const isAdmin = await requireAdmin()

    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

   const { id } = await params
const userId = String(id || '').trim()

if (!userId) {
  return NextResponse.json(
    { error: 'Missing user id' },
    { status: 400 }
  )
}

if (userId.length > 100) {
  return NextResponse.json(
    { error: 'Invalid user id' },
    { status: 400 }
  )
}

    const supabase = getSupabaseAdmin()

    const { data: userResult, error: userError } =
      await supabase.auth.admin.getUserById(userId)

    if (userError || !userResult?.user) {
    if (userError) {
  console.error('[admin-user-detail] load auth user failed:', userError.message)
}

return NextResponse.json(
  { error: 'User not found' },
  { status: 404 }
)
    }

    const user = userResult.user

    const [
      albumsResult,
      photosResult,
      storageResult,
      subscriptionResult,
      photoJobsResult,
      faceJobsResult,
      cameraSessionsResult,
      cameraImportsResult,
    ] = await Promise.all([
     supabase
  .from('albums')
  .select(`
    id,
    title,
    description,
    cover_url,
    created_at,
    updated_at,
    photos(count)
  `)
  .eq('owner_id', userId)
  .order('updated_at', { ascending: false }),

      supabase
        .from('photos')
        .select(
          `
          id,
          album_id,
          filename,
          public_url,
          preview_url,
          thumbnail_url,
          processing_status,
          file_size_bytes,
          created_at
          `
        )
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),

      supabase
        .from('user_storage_usage')
        .select(
          `
          user_id,
          current_plan,
          used_bytes,
          storage_used_bytes,
          storage_limit_bytes,
          photo_count,
          photos_count,
          albums_count,
          updated_at
          `
        )
        .eq('user_id', userId)
        .maybeSingle(),

      supabase
        .from('subscriptions')
        .select('user_id, status, plan_id, created_at, updated_at')
        .eq('user_id', userId)
        .maybeSingle(),

      supabase
        .from('photo_jobs')
        .select('id, photo_id, album_id, status, error, retry_count, created_at')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),

      supabase
        .from('face_jobs')
        .select('id, photo_id, album_id, status, error, retry_count, created_at')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),

      supabase
        .from('camera_upload_sessions')
        .select(
          `
          id,
          album_id,
          status,
          resize_mode,
          created_at,
          updated_at,
          last_activity_at,
          started_at,
          stopped_at
          `
        )
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(10),

      supabase
        .from('camera_live_imports')
        .select(
          `
          id,
          album_id,
          session_id,
          filename,
          status,
          progress,
          error,
          created_at,
          updated_at
          `
        )
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const queryErrors = [
  albumsResult.error,
  photosResult.error,
  storageResult.error,
  subscriptionResult.error,
  photoJobsResult.error,
  faceJobsResult.error,
  cameraSessionsResult.error,
  cameraImportsResult.error,
].filter(Boolean)

if (queryErrors.length > 0) {
  console.error(
    '[admin-user-detail] database query failed:',
    queryErrors.map((error) => error?.message)
  )

  return NextResponse.json(
    { error: 'Load user detail failed' },
    { status: 500 }
  )
}

    const albums = albumsResult.data || []
    const photos = photosResult.data || []
    const storage = storageResult.data || null
    const subscription = subscriptionResult.data || null
    const photoJobs = photoJobsResult.data || []
    const faceJobs = faceJobsResult.data || []
    const cameraSessions = cameraSessionsResult.data || []
    const cameraImports = cameraImportsResult.data || []

        const timeline = [
      ...albums.map((album) => ({
        id: `album-${album.id}`,
        type: 'album',
        title: 'Album activity',
        description: album.title || 'Untitled album',
        createdAt: album.updated_at || album.created_at || null,
      })),

      ...photos.slice(0, 20).map((photo) => ({
        id: `upload-${photo.id}`,
        type: 'upload',
        title: 'Uploaded photo',
        description: photo.filename || 'photo',
        createdAt: photo.created_at || null,
      })),

      ...photoJobs.slice(0, 10).map((job) => ({
        id: `photo-job-${job.id}`,
        type: 'photo_job',
        title: 'Photo processing',
        description: `${job.status || 'unknown'}${job.error ? ` · ${job.error}` : ''}`,
        createdAt: job.created_at || null,
      })),

      ...faceJobs.slice(0, 10).map((job) => ({
        id: `face-job-${job.id}`,
        type: 'face_job',
        title: 'Face scan',
        description: `${job.status || 'unknown'}${job.error ? ` · ${job.error}` : ''}`,
        createdAt: job.created_at || null,
      })),

      ...cameraImports.slice(0, 20).map((item) => ({
        id: `camera-${item.id}`,
        type: 'camera',
        title: 'Camera import',
        description: `${item.filename || 'Camera file'} · ${item.status || 'unknown'}`,
        createdAt: item.updated_at || item.created_at || null,
      })),

      ...(user.last_sign_in_at
        ? [
            {
              id: `login-${user.id}`,
              type: 'login',
              title: 'Last login',
              description: user.email || 'User login',
              createdAt: user.last_sign_in_at,
            },
          ]
        : []),
    ]
      .filter((item) => item.createdAt)
      .sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      )
      .slice(0, 40)

    const lastUploadAt = photos[0]?.created_at || null
    const lastAlbumAt =
      albums
        .map((album) => album.updated_at || album.created_at)
        .filter(Boolean)
        .sort()
        .at(-1) || null

    const lastCameraAt =
      cameraImports
        .map((item) => item.updated_at || item.created_at)
        .filter(Boolean)
        .sort()
        .at(-1) || null

    const lastActiveAt =
      [user.last_sign_in_at, lastUploadAt, lastAlbumAt, lastCameraAt]
        .filter(Boolean)
        .sort()
        .at(-1) || null

    const storageUsedBytes =
      storage?.storage_used_bytes ?? storage?.used_bytes ?? 0

    const storageLimitBytes = storage?.storage_limit_bytes ?? 0

   const albumRows = albums.map((album) => {
  const photoCount = Array.isArray(album.photos)
    ? Number(album.photos[0]?.count || 0)
    : 0

  return {
    id: album.id,
    title: album.title || 'Untitled album',
    description: album.description || null,
    coverUrl: album.cover_url || null,
    photoCount,
    createdAt: album.created_at || null,
    updatedAt: album.updated_at || null,
  }
})

    const countJobs = (status: string) => {
      const allJobs = [...photoJobs, ...faceJobs]
      return allJobs.filter((job) => job.status === status).length
    }

    return NextResponse.json({
      success: true,
      profile: {
        id: user.id,
        email: user.email || null,
        name:
          String(user.user_metadata?.full_name || '').trim() ||
          String(user.user_metadata?.name || '').trim() ||
          formatUserName(user.email),
        status: isActiveDate(lastActiveAt) ? 'active' : 'no active',
        plan: storage?.current_plan || subscription?.plan_id || 'free',
        subscriptionStatus: subscription?.status || 'inactive',
        createdAt: user.created_at || null,
        lastLoginAt: user.last_sign_in_at || null,
        lastActiveAt,
        lastUploadAt,
        storageUsedBytes,
        storageLimitBytes,
        albumCount: storage?.albums_count ?? albums.length,
        photoCount:
          storage?.photos_count ?? storage?.photo_count ?? photos.length,
      },
      albums: albumRows,
      recentUploads: photos.slice(0, 10).map((photo) => ({
        id: photo.id,
        albumId: photo.album_id,
        filename: photo.filename || 'photo',
        previewUrl: photo.thumbnail_url || photo.preview_url || photo.public_url,
        status: photo.processing_status || 'unknown',
        fileSizeBytes: photo.file_size_bytes || 0,
        createdAt: photo.created_at || null,
      })),
      jobs: {
        pending: countJobs('pending'),
        processing: countJobs('processing'),
        failed: countJobs('failed'),
        done: countJobs('done'),
        recentPhotoJobs: photoJobs.slice(0, 10),
        recentFaceJobs: faceJobs.slice(0, 10),
      },
      camera: {
        sessions: cameraSessions,
        recentImports: cameraImports,
      },
      timeline,
      checkedAt: new Date().toISOString(),
    })
   } catch (error) {
    console.error(
      '[admin-user-detail] failed:',
      error instanceof Error ? error.message : error
    )

    return NextResponse.json(
      {
        error: 'Load user detail failed',
      },
      { status: 500 }
    )
  }
}