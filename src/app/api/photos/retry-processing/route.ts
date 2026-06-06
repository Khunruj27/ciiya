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
      autoRefreshToken: false,
    },
  })
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

    const body = await req.json()
    const photoId = String(body.photoId || '').trim()

    if (!photoId) {
      return NextResponse.json({ error: 'Missing photoId' }, { status: 400 })
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

    if (!originalPath) {
      return NextResponse.json(
        { error: 'Missing original_path' },
        { status: 400 }
      )
    }

    await supabaseAdmin
      .from('photo_jobs')
      .update({
        status: 'failed',
        progress: 0,
        error: 'Superseded by manual retry',
        started_at: null,
        finished_at: new Date().toISOString(),
      })
      .eq('photo_id', photo.id)
      .in('status', ['pending', 'processing', 'failed'])

    await supabaseAdmin
      .from('photos')
      .update({
        processing_status: 'failed',
        processing_progress: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', photo.id)

    const { data: newJob, error: insertError } = await supabaseAdmin
      .from('photo_jobs')
      .insert({
        photo_id: photo.id,
        owner_id: ownerId,
        album_id: photo.album_id,
        original_path: originalPath,
        size: photo.selected_size || 'hd',
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
      })
      .select('id')
      .single()

    if (insertError || !newJob) {
      return NextResponse.json(
        { error: insertError?.message || 'Cannot create retry job' },
        { status: 500 }
      )
    }

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