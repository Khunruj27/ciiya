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

type AdminCheckResult =
  | {
      ok: true
    }
  | {
      ok: false
      status: 401 | 403 | 500
      error: string
    }

async function requireAdmin(): Promise<AdminCheckResult> {
  if (process.env.NODE_ENV === 'development') {
    return {
      ok: true,
    }
  }

  const supabase =
    await createServerSupabaseClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError) {
    console.error(
      '[admin/users] authentication failed:',
      authError.message
    )

    return {
      ok: false,
      status: 500,
      error: 'Unable to verify authentication',
    }
  }

  if (!user) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
    }
  }

  const email = String(user.email || '')
    .trim()
    .toLowerCase()

  if (
    !email ||
    !getAdminEmails().includes(email)
  ) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden',
    }
  }

  return {
    ok: true,
  }
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

export async function GET() {
  try {
   const adminCheck = await requireAdmin()

if (!adminCheck.ok) {
  return NextResponse.json(
    {
      error: adminCheck.error,
    },
    {
      status: adminCheck.status,
    }
  )
}

    const supabase = getSupabaseAdmin()

    const { data: usersData, error: usersError } =
      await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      })

    if (usersError) {
  console.error(
    '[admin/users] auth user listing failed:',
    usersError.message
  )

  return NextResponse.json(
    {
      error: 'Unable to load users',
    },
    {
      status: 500,
    }
  )
}

    const users = usersData.users || []
    const userIds = users.map((user) => user.id)

    const [albumsResult, photosResult, storageResult, subscriptionsResult] =
      await Promise.all([
        supabase
          .from('albums')
          .select('id, owner_id, user_id, created_at, updated_at')
          .in('owner_id', userIds),

        supabase
          .from('photos')
          .select('id, owner_id, user_id, file_size_bytes, created_at')
          .in('owner_id', userIds),

        supabase
          .from('user_storage_usage')
          .select(
            'user_id, current_plan, used_bytes, storage_used_bytes, storage_limit_bytes, photo_count, photos_count, albums_count, updated_at'
          )
          .in('user_id', userIds),

        supabase
          .from('subscriptions')
          .select('user_id, status, plan_id, created_at, updated_at')
          .in('user_id', userIds),
      ])

      const relatedQueryErrors = [
  {
    name: 'albums',
    error: albumsResult.error,
  },
  {
    name: 'photos',
    error: photosResult.error,
  },
  {
    name: 'storage usage',
    error: storageResult.error,
  },
  {
    name: 'subscriptions',
    error: subscriptionsResult.error,
  },
].filter(
  (
    item
  ): item is {
    name: string
    error: NonNullable<
      typeof albumsResult.error
    >
  } => Boolean(item.error)
)

if (relatedQueryErrors.length > 0) {
  for (const item of relatedQueryErrors) {
    console.error(
      `[admin/users] load ${item.name} failed:`,
      item.error.message
    )
  }

  return NextResponse.json(
    {
      error: 'Unable to load user statistics',
    },
    {
      status: 500,
    }
  )
}

    const albums = albumsResult.data || []
    const photos = photosResult.data || []
    const storageRows = storageResult.data || []
    const subscriptions = subscriptionsResult.data || []

    const rows = users.map((user) => {
      const userAlbums = albums.filter(
        (album) => album.owner_id === user.id || album.user_id === user.id
      )

      const userPhotos = photos.filter(
        (photo) => photo.owner_id === user.id || photo.user_id === user.id
      )

      const storage = storageRows.find((row) => row.user_id === user.id)
      const subscription = subscriptions.find((row) => row.user_id === user.id)

      const lastUploadAt =
        userPhotos
          .map((photo) => photo.created_at)
          .filter(Boolean)
          .sort()
          .at(-1) || null

      const lastAlbumAt =
        userAlbums
          .map((album) => album.updated_at || album.created_at)
          .filter(Boolean)
          .sort()
          .at(-1) || null

      const lastActiveAt =
        [user.last_sign_in_at, lastUploadAt, lastAlbumAt]
          .filter(Boolean)
          .sort()
          .at(-1) || null

      const active = isActiveDate(lastActiveAt)

      return {
        id: user.id,
        email: user.email || null,
        name:
          String(user.user_metadata?.full_name || '').trim() ||
          String(user.user_metadata?.name || '').trim() ||
          formatUserName(user.email),
        status: active ? 'active' : 'no active',
        lastActiveAt,
        lastSignInAt: user.last_sign_in_at || null,
        createdAt: user.created_at || null,
        albumCount: storage?.albums_count ?? userAlbums.length,
        photoCount:
          storage?.photos_count ?? storage?.photo_count ?? userPhotos.length,
        storageUsedBytes:
          storage?.storage_used_bytes ?? storage?.used_bytes ?? 0,
        storageLimitBytes: storage?.storage_limit_bytes ?? 0,
        plan: storage?.current_plan || subscription?.status || 'free',
        subscriptionStatus: subscription?.status || 'inactive',
        lastUploadAt,
      }
    })

    const activeUsers = rows.filter((row) => row.status === 'active').length
    const totalPhotos = rows.reduce((sum, row) => sum + row.photoCount, 0)
    const totalAlbums = rows.reduce((sum, row) => sum + row.albumCount, 0)
    const totalStorageUsed = rows.reduce(
      (sum, row) => sum + Number(row.storageUsedBytes || 0),
      0
    )

    const todayStart = new Date()
todayStart.setHours(0, 0, 0, 0)


const todayUploads = photos.filter((photo) => {
  if (!photo.created_at) return false
  return new Date(photo.created_at).getTime() >= todayStart.getTime()
}).length

const todayActiveUsers = rows.filter((row) => {
  if (!row.lastActiveAt) return false
  return new Date(row.lastActiveAt).getTime() >= todayStart.getTime()
}).length

const newUsersToday = rows.filter((row) => {
  if (!row.createdAt) return false
  return new Date(row.createdAt).getTime() >= todayStart.getTime()
}).length

const topStorageUsers = [...rows]
  .sort(
    (a, b) =>
      Number(b.storageUsedBytes || 0) - Number(a.storageUsedBytes || 0)
  )
  .slice(0, 5)
  .map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    storageUsedBytes: row.storageUsedBytes,
  }))

const topPhotoUsers = [...rows]
  .sort((a, b) => Number(b.photoCount || 0) - Number(a.photoCount || 0))
  .slice(0, 5)
  .map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    photoCount: row.photoCount,
  }))

const recentNewUsers = [...rows]
  .sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  )
  .slice(0, 5)
  .map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt,
  }))

const uploadHours = Array.from({ length: 24 }).map((_, hour) => {
  const count = photos.filter((photo) => {
    if (!photo.created_at) return false

    const date = new Date(photo.created_at)

    return (
      date.getTime() >= todayStart.getTime() &&
      date.getHours() === hour
    )
  }).length

  return {
    hour,
    count,
  }
})

    return NextResponse.json({
      success: true,
      summary: {
  totalUsers: rows.length,
  activeUsers,
  inactiveUsers: rows.length - activeUsers,
  totalPhotos,
  totalAlbums,
  totalStorageUsed,
  todayUploads,
  todayActiveUsers,
  newUsersToday,
  topStorageUsers,
  topPhotoUsers,
  recentNewUsers,
  uploadHours,
},
      users: rows.sort((a, b) =>
        String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || ''))
      ),
      checkedAt: new Date().toISOString(),
    })
} catch (error) {
  console.error(
    '[admin/users] unexpected error:',
    error
  )

  return NextResponse.json(
    {
      error: 'Unable to load users',
    },
    {
      status: 500,
    }
  )
}
}