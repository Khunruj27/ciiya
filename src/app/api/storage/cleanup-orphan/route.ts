import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'albums'
const DEFAULT_MAX_DELETE_PER_RUN = 100
const MIN_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function isAuthorized(req: NextRequest) {
  const workerSecret = req.headers.get('x-worker-secret')

  if (
    process.env.WORKER_SECRET &&
    workerSecret &&
    workerSecret === process.env.WORKER_SECRET
  ) {
    return {
      ok: true,
      status: 200,
      error: null,
      actor: 'worker',
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
      actor: null,
    }
  }

  const isAdmin =
    process.env.NODE_ENV === 'development' ||
    getAdminEmails().includes(user.email.toLowerCase())

  if (!isAdmin) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden',
      actor: user.email,
    }
  }

  return {
    ok: true,
    status: 200,
    error: null,
    actor: user.email,
  }
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

function addPath(set: Set<string>, value?: string | null) {
  if (!value) return

  const trimmed = String(value).trim()

  if (!trimmed) return

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return
  }

  set.add(trimmed)
}

function getAlbumScopedPhotoKey(path: string) {
  const parts = path.split('/')

  if (parts.length < 3) return null

  const ownerId = parts[0]
  const albumId = parts[1]
  const filename = parts[parts.length - 1]

  if (!ownerId || !albumId || !filename) return null

  return `${ownerId}/${albumId}/${filename}`
}

function addPhotoSiblingPaths(usedPaths: Set<string>, path?: string | null) {
  if (!path) return

  addPath(usedPaths, path)

  const parts = path.split('/')

  if (parts.length < 3) return

  const ownerId = parts[0]
  const albumId = parts[1]
  const filename = parts[parts.length - 1]

  if (!ownerId || !albumId || !filename) return

  const folders = [
    'photos',
    'original',
    'preview',
    'thumbnail',
    'sd',
    'hd',
    'uhd',
  ]

  for (const folder of folders) {
    usedPaths.add(`${ownerId}/${albumId}/${folder}/${filename}`)
  }
}

function isUnsafeCleanupPath(path: string) {
  const normalized = path.toLowerCase()

  return (
    normalized.includes('/preset/') ||
    normalized.includes('/presets/') ||
    normalized.includes('/avatar/') ||
    normalized.includes('/avatars/') ||
    normalized.includes('/profile/') ||
    normalized.includes('/cover/') ||
    normalized.includes('/covers/') ||
    normalized.endsWith('.xmp')
  )
}

type StorageFile = {
  path: string
  createdAt: string | null
}

async function listFilesRecursive(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  prefix: string,
  output: StorageFile[] = []
) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(prefix, {
      limit: 1000,
      sortBy: {
        column: 'name',
        order: 'asc',
      },
    })

  if (error) throw new Error(error.message)

  for (const item of data || []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name

    if (item.metadata) {
     output.push({
  path,
  createdAt: item.created_at || null,
})
    } else {
      await listFilesRecursive(supabase, path, output)
    }
  }

  return output
}

async function collectUsedPhotoPaths(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  usedPaths: Set<string>
) {
  const { data, error } = await supabase
    .from('photos')
    .select(
      `
      original_path,
      storage_path,
      preview_path,
      thumbnail_path,
      sd_path,
      hd_path,
      uhd_path
      `
    )

  if (error) throw new Error(error.message)

  for (const photo of data || []) {
  addPhotoSiblingPaths(usedPaths, photo.original_path)
  addPhotoSiblingPaths(usedPaths, photo.storage_path)
  addPhotoSiblingPaths(usedPaths, photo.preview_path)
  addPhotoSiblingPaths(usedPaths, photo.thumbnail_path)
  addPhotoSiblingPaths(usedPaths, photo.sd_path)
  addPhotoSiblingPaths(usedPaths, photo.hd_path)
  addPhotoSiblingPaths(usedPaths, photo.uhd_path)
}
}

function extractStoragePathFromPublicUrl(value?: string | null) {
  if (!value) return null

  const marker = '/storage/v1/object/public/albums/'
  const index = value.indexOf(marker)

  if (index === -1) return null

  return value.substring(index + marker.length)
}

async function collectAlbumPaths(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  usedPaths: Set<string>
) {
  const { data, error } = await supabase
    .from('albums')
    .select(
      `
      cover_url,
      cover_path,
      cover_storage_path,
      album_preset_path
      `
    )

  if (error) {
    console.error('[cleanup-orphan] albums path scan skipped:', error.message)
    return
  }

  for (const album of data || []) {
    addPath(usedPaths, album.cover_path)
    addPath(usedPaths, album.cover_storage_path)
    addPath(usedPaths, album.album_preset_path)

    const coverPath = extractStoragePathFromPublicUrl(album.cover_url)

    if (coverPath) {
      usedPaths.add(coverPath)
    }
  }
}

async function collectCameraPaths(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  usedPaths: Set<string>
) {
  const { data: imports } = await supabase
    .from('camera_live_imports')
    .select('storage_path')

  for (const item of imports || []) {
    addPath(usedPaths, item.storage_path)
  }

  const { data: sessions } = await supabase
    .from('camera_upload_sessions')
    .select('preset_path')

  for (const session of sessions || []) {
    addPath(usedPaths, session.preset_path)
  }
}

async function collectProfilePaths(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  usedPaths: Set<string>
) {
  const { data, error } = await supabase
    .from('profiles')
    .select('avatar_path, avatar_storage_path')

  if (error) {
    console.error('[cleanup-orphan] profile path scan skipped:', error.message)
    return
  }

  for (const profile of data || []) {
    addPath(usedPaths, profile.avatar_path)
    addPath(usedPaths, profile.avatar_storage_path)
  }
}


export async function POST(req: NextRequest) {
  try {
    const auth = await isAuthorized(req)

    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      )
    }

    const body = await req.json().catch(() => ({}))
    const dryRun = body.dryRun !== false
    const prefix = String(body.prefix || '').trim()

    const requestedLimit = Number(body.limit || DEFAULT_MAX_DELETE_PER_RUN)

const maxDeletePerRun =
  Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, DEFAULT_MAX_DELETE_PER_RUN)
    : DEFAULT_MAX_DELETE_PER_RUN

    const supabase = getSupabaseAdmin()

    const allStorageFiles = await listFilesRecursive(supabase, prefix)

    const usedPaths = new Set<string>()

    await collectUsedPhotoPaths(supabase, usedPaths)
    await collectAlbumPaths(supabase, usedPaths)
    await collectCameraPaths(supabase, usedPaths)
    await collectProfilePaths(supabase, usedPaths)

    const usedPhotoKeys = new Set(
  Array.from(usedPaths)
    .map((path) => getAlbumScopedPhotoKey(path))
    .filter((value): value is string => Boolean(value))
)

const usedExistingCount = allStorageFiles.filter((file) =>
  usedPaths.has(file.path)
).length

const now = Date.now()

const orphanFiles = allStorageFiles
  .filter((file) => {
    const path = file.path

    if (usedPaths.has(path)) return false
    if (isUnsafeCleanupPath(path)) return false

    const photoKey = getAlbumScopedPhotoKey(path)

    if (photoKey && usedPhotoKeys.has(photoKey)) {
      return false
    }

    if (file.createdAt) {
      const ageMs = now - new Date(file.createdAt).getTime()

      if (ageMs < MIN_ORPHAN_AGE_MS) {
        return false
      }
    }

    return true
  })
  .map((file) => file.path)

    const targetFiles = orphanFiles.slice(0, maxDeletePerRun)

    if (!dryRun && targetFiles.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove(targetFiles)

      if (removeError) {
        throw new Error(removeError.message)
      }
    }

    await supabase.from('worker_logs').insert({
      worker_type: 'storage-cleanup',
      level: 'info',
      message: dryRun
        ? 'Storage cleanup dry run completed'
        : 'Storage cleanup deleted orphan files',
      metadata: {
        actor: auth.actor,
        dryRun,
        bucket: BUCKET,
        prefix,
        scanned: allStorageFiles.length,
        used: usedExistingCount,
        orphanCount: orphanFiles.length,
        deletedCount: dryRun ? 0 : targetFiles.length,
        limit: maxDeletePerRun,
      },
    })

   

    return NextResponse.json({
      success: true,
      dryRun,
      bucket: BUCKET,
      prefix,
      scanned: allStorageFiles.length,
      used: usedExistingCount,
      orphanCount: orphanFiles.length,
      deletedCount: dryRun ? 0 : targetFiles.length,
      limit: maxDeletePerRun,
      sample: orphanFiles.slice(0, 20),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Cleanup orphan failed',
      },
      { status: 500 }
    )
  }
}