import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function isJpgFile(filename: string) {
  const lower = filename.toLowerCase()
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg')
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
    const cameraFileId = String(body?.cameraFileId || '').trim()
    const filename = String(body?.filename || '').trim()
    const localPath = body?.localPath ? String(body.localPath).trim() : null
    const fileSizeBytes = Number(body?.fileSizeBytes || 0)

    if (!albumId || !cameraFileId || !filename) {
      return NextResponse.json(
        { error: 'Missing albumId, cameraFileId, or filename' },
        { status: 400 }
      )
    }

    if (!isJpgFile(filename)) {
      return NextResponse.json(
        { error: 'Only JPG/JPEG files are allowed' },
        { status: 400 }
      )
    }

    const { data: session, error: sessionError } = await supabase
      .from('camera_upload_sessions')
      .select('id, album_id, owner_id, status')
      .eq('album_id', albumId)
      .eq('owner_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (sessionError || !session) {
      return NextResponse.json(
        {
          error: sessionError?.message || 'No active camera upload session',
        },
        { status: 404 }
      )
    }

    const { data, error } = await supabase
      .from('camera_live_imports')
      .upsert(
        {
          session_id: session.id,
          album_id: albumId,
          owner_id: user.id,
          camera_file_id: cameraFileId,
          filename,
          local_path: localPath,
          file_size_bytes: fileSizeBytes,
          status: 'pending',
          progress: 0,
          detected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'album_id,camera_file_id',
          ignoreDuplicates: true,
        }
      )
      .select('*')
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      import: data,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Create live import failed',
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
      .from('camera_live_imports')
      .select('*')
      .eq('album_id', albumId)
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const imports = data || []

    return NextResponse.json({
      success: true,
      imports,
      pending: imports.filter((item) => item.status === 'pending').length,
      processing: imports.filter((item) => item.status === 'processing').length,
      done: imports.filter((item) => item.status === 'done').length,
      failed: imports.filter((item) => item.status === 'failed').length,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Fetch live imports failed',
      },
      { status: 500 }
    )
  }
}