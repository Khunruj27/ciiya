import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'

type RequestedSize = 'sd' | 'hd' | 'uhd' | 'original'

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase admin env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function normalizeRequestedSize(
  value?: string | null
): RequestedSize {
  const normalizedValue = String(value || '')
    .trim()
    .toLowerCase()

  if (normalizedValue === 'sd') return 'sd'
  if (normalizedValue === 'uhd') return 'uhd'
  if (normalizedValue === 'original') return 'original'

  return 'hd'
}

function hasUnsafeStoragePath(path: string) {
  const lowerPath = path.toLowerCase()

  return (
    path.includes('..') ||
    path.includes('\\') ||
    path.includes('//') ||
    lowerPath.includes('%2e') ||
    lowerPath.includes('%2f') ||
    lowerPath.includes('%5c')
  )
}

async function storageObjectExists(
  supabaseAdmin: SupabaseClient,
  storagePath: string,
  bucket = 'albums'
) {
  const parts = storagePath.split('/')
  const fileName = parts.pop()

  if (!fileName || parts.length === 0) {
    return false
  }

  const folder = parts.join('/')

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .list(folder, {
      limit: 5,
      search: fileName,
    })

  if (error) {
    throw new Error(error.message)
  }

  return data.some((item) => item.name === fileName)
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const supabaseAdmin = getSupabaseAdmin()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)

if (!body) {
  return NextResponse.json(
    { error: 'Invalid request body' },
    { status: 400 }
  )
}

const photoId = String(body.photoId || '').trim()

    if (!photoId) {
      return NextResponse.json({ error: 'Missing photoId' }, { status: 400 })
    }

    if (photoId.length > 100) {
  return NextResponse.json(
    { error: 'Invalid photoId' },
    { status: 400 }
  )
}

    const { data: photo, error: photoError } = await supabaseAdmin
      .from('photos')
      .select(
        `
        id,
        album_id,
        owner_id,
        user_id,
        original_path,
        storage_path,
        selected_size,
        preset_path
        `
      )
      .eq('id', photoId)
      .maybeSingle()

    if (photoError || !photo) {
      return NextResponse.json(
        { error: photoError?.message || 'Photo not found' },
        { status: 404 }
      )
    }

    const ownerId = photo.owner_id || photo.user_id

    if (ownerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const originalPath = photo.original_path || photo.storage_path

    const requestedSize = normalizeRequestedSize(
  photo.selected_size
)

    if (!originalPath) {
      return NextResponse.json(
        { error: 'Missing original_path' },
        { status: 400 }
      )
    }

    const albumPrefix = `${ownerId}/${photo.album_id}/`

const allowedOriginalPrefixes = [
  `${albumPrefix}original/`,
  `${albumPrefix}hd/`,
  `${albumPrefix}preview/`,
]

const expectedAlbumPresetPrefix = `${albumPrefix}presets/`
const expectedUserPresetPrefix = `${ownerId}/presets/`

    if (hasUnsafeStoragePath(originalPath)) {
  return NextResponse.json(
    { error: 'Invalid original path' },
    { status: 400 }
  )
}

if (
  photo.preset_path &&
  hasUnsafeStoragePath(photo.preset_path)
) {
  return NextResponse.json(
    { error: 'Invalid preset path' },
    { status: 400 }
  )
}

const originalExists = await storageObjectExists(
  supabaseAdmin,
  originalPath
)

if (!originalExists) {
  return NextResponse.json(
    { error: 'Original file not found' },
    { status: 400 }
  )
}

if (photo.preset_path) {
  const presetBucket = photo.preset_path.startsWith(
    expectedUserPresetPrefix
  )
    ? 'presets'
    : 'albums'

  const presetExists = await storageObjectExists(
    supabaseAdmin,
    photo.preset_path,
    presetBucket
  )

  if (!presetExists) {
    return NextResponse.json(
      { error: 'Preset file not found' },
      { status: 400 }
    )
  }
}

if (
  !allowedOriginalPrefixes.some((prefix) =>
    originalPath.startsWith(prefix)
  )
) {
  return NextResponse.json(
    { error: 'Invalid original path' },
    { status: 400 }
  )
}

if (
  photo.preset_path &&
  !photo.preset_path.startsWith(expectedAlbumPresetPrefix) &&
  !photo.preset_path.startsWith(expectedUserPresetPrefix)
) {
  return NextResponse.json(
    { error: 'Invalid preset path' },
    { status: 400 }
  )
}

const { data: activeJob, error: activeJobError } =
  await supabaseAdmin
    .from('photo_jobs')
    .select('id')
    .eq('photo_id', photo.id)
    .in('status', ['pending', 'processing'])
    .maybeSingle()

if (activeJobError) {
  return NextResponse.json(
    { error: activeJobError.message },
    { status: 500 }
  )
}

if (activeJob) {
  return NextResponse.json({
    success: true,
    photoId: photo.id,
    jobId: activeJob.id,
    status: 'pending',
  })
}

 const { error: supersedeJobError } =
  await supabaseAdmin
    .from('photo_jobs')
    .update({
      status: 'failed',
      progress: 0,
      error: 'Superseded by manual retry',
      started_at: null,
      finished_at: new Date().toISOString(),
      worker_id: null,
      claimed_by: null,
    })
    .eq('photo_id', photo.id)
    .in('status', ['pending', 'processing', 'failed'])

if (supersedeJobError) {
  return NextResponse.json(
    { error: supersedeJobError.message },
    { status: 500 }
  )
}

   const { error: markPhotoFailedError } =
  await supabaseAdmin
    .from('photos')
    .update({
      processing_status: 'failed',
      processing_progress: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photo.id)

if (markPhotoFailedError) {
  return NextResponse.json(
    { error: markPhotoFailedError.message },
    { status: 500 }
  )
}

 const { data: newJob, error: insertError } =
  await supabaseAdmin
    .from('photo_jobs')
    .insert({
      photo_id: photo.id,
      owner_id: ownerId,
      album_id: photo.album_id,
      original_path: originalPath,
      size: requestedSize,
      preset_path: photo.preset_path || null,
      status: 'pending',
      priority: 1,
      progress: 0,
      retry_count: 0,
      retries: 0,
      started_at: null,
      finished_at: null,
      error: null,
      payload: {
        source: 'manual-retry',
        photoId: photo.id,
        originalPath,
        presetPath: photo.preset_path || null,
      },
      updated_at: new Date().toISOString(),
      worker_id: null,
      claimed_by: null,
    })
    .select('id')
    .single()

    if (insertError || !newJob) {
  console.error(
    '[photos/retry-processing] create retry job failed:',
    insertError?.message || 'No job returned'
  )

  return NextResponse.json(
    { error: 'Cannot create retry job' },
    { status: 500 }
  )
}

   const { error: markPhotoPendingError } =
  await supabaseAdmin
    .from('photos')
    .update({
      processing_status: 'pending',
      processing_progress: 0,
      face_scan_status: 'pending',
      face_scan_progress: 0,
      face_scan_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photo.id)

if (markPhotoPendingError) {
  return NextResponse.json(
    { error: markPhotoPendingError.message },
    { status: 500 }
  )
}

    return NextResponse.json({
      success: true,
      photoId: photo.id,
      jobId: newJob.id,
      status: 'pending',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Retry processing failed',
      },
      { status: 500 }
    )
  }
}