import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const GPHOTO_BIN = process.env.GPHOTO_BIN || 'gphoto2'

function parseCameraName(stdout: string) {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const cameraLine = lines.find(
    (line) =>
      !line.toLowerCase().startsWith('model') &&
      !line.startsWith('-') &&
      line.includes('usb:')
  )

  if (!cameraLine) return null

  return cameraLine.replace(/\s+usb:.+$/, '').trim() || null
}

function splitCameraBrandAndModel(cameraName: string) {
  const [brand, ...rest] = cameraName.trim().split(/\s+/)

  return {
    brand: brand || null,
    model: rest.join(' ') || null,
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

    const body = await req.json().catch(() => null)
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

    const { stdout } = await execFileAsync(GPHOTO_BIN, ['--auto-detect'], {
      timeout: 7000,
    })

    const cameraName = parseCameraName(stdout)

    if (!cameraName) {
      return NextResponse.json(
        { error: 'No camera detected' },
        { status: 404 }
      )
    }

    const { brand: cameraBrand, model: cameraModel } =
      splitCameraBrandAndModel(cameraName)

    // Close out any row still marked 'connected' for this album before
    // adding a new one, so repeated plug/unplug cycles (auto-detect can
    // reconnect many times a day) don't pile up stale 'connected' rows.
    await supabase
      .from('camera_sessions')
      .update({
        status: 'disconnected',
        disconnected_at: new Date().toISOString(),
      })
      .eq('album_id', albumId)
      .eq('user_id', user.id)
      .eq('status', 'connected')

    await supabase.from('camera_sessions').insert({
      user_id: user.id,
      album_id: albumId,
      camera_brand: cameraBrand,
      camera_model: cameraModel,
      camera_name: cameraName,
      status: 'connected',
      auto_import: true,
      auto_apply_xmp: true,
      auto_face_ai: true,
      auto_resize: true,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
    })


    return NextResponse.json({
  success: true,
  connected: true,
  cameraName,
})

  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Connect camera failed',
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

    await supabase
      .from('camera_upload_sessions')
      .update({
        status: 'stopped',
        updated_at: new Date().toISOString(),
      })
      .eq('album_id', albumId)
      .eq('owner_id', user.id)
      .eq('status', 'active')

    await supabase
      .from('camera_sessions')
      .update({
        status: 'disconnected',
        disconnected_at: new Date().toISOString(),
      })
      .eq('album_id', albumId)
      .eq('user_id', user.id)
      .eq('status', 'connected')

    return NextResponse.json({
      success: true,
      connected: false,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Disconnect camera failed',
      },
      { status: 500 }
    )
  }
}