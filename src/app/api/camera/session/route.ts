import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

type CameraSessionRow = {
  id: string
  user_id: string
  album_id: string
  camera_brand: string | null
  camera_model: string | null
  camera_name: string | null
  serial_number: string | null
  status: string | null
  battery_percent: number | null
  storage_remaining_gb: number | null
  auto_import: boolean | null
  auto_apply_xmp: boolean | null
  auto_face_ai: boolean | null
  auto_resize: boolean | null
  connected_at: string | null
  disconnected_at: string | null
  created_at: string | null
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
    const albumId = searchParams.get('albumId')

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
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    const { data: session, error: sessionError } = await supabase
      .from('camera_sessions')
      .select(`
        id,
        user_id,
        album_id,
        camera_brand,
        camera_model,
        camera_name,
        serial_number,
        status,
        battery_percent,
        storage_remaining_gb,
        auto_import,
        auto_apply_xmp,
        auto_face_ai,
        auto_resize,
        connected_at,
        disconnected_at,
        created_at
      `)
      .eq('album_id', albumId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<CameraSessionRow>()

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 })
    }

    if (!session) {
      return NextResponse.json({
        connected: false,
        status: 'disconnected',
        cameraBrand: null,
        cameraModel: null,
        cameraName: null,
        batteryPercent: null,
        storageRemainingGb: null,
        autoImport: false,
        autoApplyXmp: true,
        autoFaceAi: true,
        autoResize: true,
        sessionId: null,
        connectedAt: null,
      })
    }

    const cameraName =
      session.camera_name ||
      [session.camera_brand, session.camera_model].filter(Boolean).join(' ')

    const connected = session.status === 'connected'

    return NextResponse.json({
      connected,
      status: session.status || 'disconnected',
      cameraBrand: session.camera_brand,
      cameraModel: session.camera_model,
      cameraName: cameraName || null,
      batteryPercent: session.battery_percent,
      storageRemainingGb: session.storage_remaining_gb,
      autoImport: Boolean(session.auto_import),
      autoApplyXmp: session.auto_apply_xmp !== false,
      autoFaceAi: session.auto_face_ai !== false,
      autoResize: session.auto_resize !== false,
      sessionId: session.id,
      connectedAt: session.connected_at,
      disconnectedAt: session.disconnected_at,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Fetch camera session failed',
      },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const albumId = String(body?.albumId || '').trim()

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
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    const cameraBrand =
      typeof body?.cameraBrand === 'string'
        ? body.cameraBrand.trim() || null
        : null

    const cameraModel =
      typeof body?.cameraModel === 'string'
        ? body.cameraModel.trim() || null
        : null

    const cameraName =
      typeof body?.cameraName === 'string'
        ? body.cameraName.trim() || null
        : [cameraBrand, cameraModel].filter(Boolean).join(' ') || null

    const connected = body?.connected === true

    const batteryPercent =
      typeof body?.batteryPercent === 'number'
        ? Math.max(0, Math.min(100, Math.round(body.batteryPercent)))
        : null

    const storageRemainingGb =
      typeof body?.storageRemainingGb === 'number'
        ? Math.max(0, body.storageRemainingGb)
        : null

    const { data: session, error: sessionError } = await supabase
      .from('camera_sessions')
      .insert({
        user_id: user.id,
        album_id: albumId,
        camera_brand: cameraBrand,
        camera_model: cameraModel,
        camera_name: cameraName,
        status: connected ? 'connected' : 'disconnected',
        battery_percent: batteryPercent,
        storage_remaining_gb: storageRemainingGb,
        auto_import: true,
        auto_apply_xmp: true,
        auto_face_ai: true,
        auto_resize: true,
        connected_at: connected ? new Date().toISOString() : null,
        disconnected_at: connected ? null : new Date().toISOString(),
      })
      .select(
        `
        id,
        user_id,
        album_id,
        camera_brand,
        camera_model,
        camera_name,
        serial_number,
        status,
        battery_percent,
        storage_remaining_gb,
        auto_import,
        auto_apply_xmp,
        auto_face_ai,
        auto_resize,
        connected_at,
        disconnected_at,
        created_at
        `
      )
      .single<CameraSessionRow>()

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      session,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Create camera session failed',
      },
      { status: 500 }
    )
  }
}