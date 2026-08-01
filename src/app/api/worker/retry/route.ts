import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase admin env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
    },
  })
}

function hasUnsafeStoragePath(path: string) {
  const lowerPath = path.toLowerCase()

  return (
    path.includes('..') ||
    path.includes('\\') ||
    lowerPath.includes('%2f') ||
    lowerPath.includes('%5c') ||
    path.includes('//')
  )
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
  return NextResponse.json(
    { error: 'photoId is required' },
    { status: 400 }
  )
}

if (photoId.length > 100) {
  return NextResponse.json(
    { error: 'Invalid photoId' },
    { status: 400 }
  )
}

    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select(
        `
        id,
        album_id,
        owner_id,
        original_path,
        storage_path
      `
      )
      .eq('id', photoId)
      .eq('owner_id', user.id)
      .single()

    if (photoError || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    const originalPath = photo.original_path || photo.storage_path

     if (!originalPath) {
      return NextResponse.json(
        { error: 'Original path not found' },
        { status: 400 }
      )
    }

    const allowedPrefix = `${user.id}/${photo.album_id}/`

if (
  !originalPath.startsWith(allowedPrefix) ||
  hasUnsafeStoragePath(originalPath)
) {
  return NextResponse.json(
    { error: 'Invalid original path' },
    { status: 400 }
  )
}

   const { data: activeJob } = await supabaseAdmin
  .from('photo_jobs')
  .select('id')
  .eq('photo_id', photo.id)
  .in('status', ['pending', 'processing'])
  .maybeSingle()

if (activeJob) {
  return NextResponse.json({
    success: true,
    retried: false,
    photoId: photo.id,
    jobId: activeJob.id,
  })
}

    const { error: insertJobError } = await supabaseAdmin
      .from('photo_jobs')
      .upsert(
  {
    photo_id: photo.id,
    owner_id: user.id,
    album_id: photo.album_id,
    original_path: originalPath,
    size: 'original',
    preset_path: null,
    status: 'pending',
    priority: 1,
    progress: 0,
    retry_count: 0,
    retries: 0,
    started_at: null,
    finished_at: null,
    error: null,
    worker_id: null,
    claimed_by: null,
    updated_at: new Date().toISOString(),
  },
  {
    onConflict: 'photo_id',
  }
)

    if (insertJobError) {
      return NextResponse.json(
        { error: insertJobError.message },
        { status: 500 }
      )
    }

    const { error: updatePhotoError } = await supabaseAdmin
      .from('photos')
      .update({
  processing_status: 'pending',
  processing_progress: 0,
  updated_at: new Date().toISOString(),
})
      .eq('id', photo.id)
      .eq('owner_id', user.id)
      

    if (updatePhotoError) {
      return NextResponse.json(
        { error: updatePhotoError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      retried: true,
      photoId: photo.id,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Retry failed',
      },
      { status: 500 }
    )
  }
}