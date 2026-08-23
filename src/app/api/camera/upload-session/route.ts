import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function normalizeResizeMode(value: unknown) {
  const mode = String(value || 'original').toLowerCase()

  if (mode === 'sd') return 'sd'
  if (mode === 'hd') return 'hd'
  if (mode === 'uhd') return 'uhd'
  if (mode === 'original') return 'original'

  return 'original'
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()

   let user = null

try {
  const result = await supabase.auth.getUser()
  user = result.data.user
} catch (error) {
  console.warn('[camera] auth getUser failed:', error)

  return NextResponse.json(
    {
      error: 'Auth temporarily unavailable',
      code: 'AUTH_FETCH_FAILED',
    },
    { status: 503 }
  )
}

if (!user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

    const body = await req.json().catch(() => null)

    const albumId = String(body?.albumId || '').trim()
    const presetPath = body?.presetPath ? String(body.presetPath).trim() : null
    const resizeMode = normalizeResizeMode(body?.resizeMode)
    const autoFaceScan = body?.autoFaceScan ?? true
    const autoPublish = body?.autoPublish ?? false

    if (!albumId) {
      return NextResponse.json({ error: 'Missing albumId' }, { status: 400 })
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, owner_id')
      .eq('id', albumId)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (albumError || !album) {
      return NextResponse.json(
        {
          error: albumError?.message || 'Album not found',
          albumId,
        },
        { status: 404 }
      )
    }

    await supabase
      .from('camera_upload_sessions')
      .update({
  status: 'stopped',
  stopped_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})
      .eq('album_id', albumId)
      .eq('owner_id', user.id)
      .eq('status', 'active')

    const now = new Date().toISOString()

const { data, error } = await supabase
  .from('camera_upload_sessions')
  .insert({
    album_id: albumId,
    owner_id: user.id,
    preset_path: presetPath,
    resize_mode: resizeMode,
    auto_face_scan: Boolean(autoFaceScan),
    auto_publish: Boolean(autoPublish),
    status: 'active',
    started_at: now,
    stopped_at: null,
    last_activity_at: now,
    updated_at: now,
  })
  .select('*')
  .single()

    if (error || !data) {
      return NextResponse.json(
        {
          error: error?.message || 'Create session failed',
          albumId,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      session: data,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Create session failed',
      },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const albumId = String(searchParams.get('albumId') || '').trim()

    if (!albumId) {
      return NextResponse.json({ error: 'Missing albumId' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('camera_upload_sessions')
      .select('*')
      .eq('album_id', albumId)
      .eq('owner_id', user.id)
      .eq('status', 'active')
      .order('created_at', {
        ascending: false,
      })
      .limit(1)
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        {
          error: error.message,
          active: false,
          session: null,
        },
        { status: 500 }
      )
    }

    // No active session right now — fall back to the most recent stopped
    // one just so the caller can pre-fill last-used settings (preset,
    // resize mode) instead of resetting to bare defaults on every reload.
    let lastSession = data

    if (!lastSession) {
      const { data: previous } = await supabase
        .from('camera_upload_sessions')
        .select('*')
        .eq('album_id', albumId)
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      lastSession = previous || null
    }

    return NextResponse.json({
      active: Boolean(data),
      session: lastSession,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Fetch session failed',
        active: false,
        session: null,
      },
      { status: 500 }
    )
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const albumId = String(searchParams.get('albumId') || '').trim()

    if (!albumId) {
      return NextResponse.json({ error: 'Missing albumId' }, { status: 400 })
    }

    const now = new Date().toISOString()

const { error } = await supabase
  .from('camera_upload_sessions')
  .update({
    status: 'stopped',
    stopped_at: now,
    updated_at: now,
  })
  .eq('album_id', albumId)
  .eq('owner_id', user.id)
  .eq('status', 'active')
      .eq('album_id', albumId)
      .eq('owner_id', user.id)
      .eq('status', 'active')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Stop session failed',
      },
      { status: 500 }
    )
  }
}