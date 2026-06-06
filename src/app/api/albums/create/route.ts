import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function createShareToken() {
  return crypto.randomBytes(16).toString('hex')
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const title = String(body?.title || '').trim()
    const description = String(body?.description || '').trim()

    const uploadMode = body?.uploadMode === 'auto' ? 'auto' : 'manual'

const uploadSize =
  body?.uploadSize === 'sd' ||
  body?.uploadSize === 'hd' ||
  body?.uploadSize === 'original'
    ? body.uploadSize
    : 'uhd'

const uploadProfile =
  body?.uploadProfile === 'quick' ||
  body?.uploadProfile === 'standard' ||
  body?.uploadProfile === 'original'
    ? body.uploadProfile
    : 'professional'

const albumPresetPath =
  typeof body?.albumPresetPath === 'string'
    ? body.albumPresetPath.trim() || null
    : null

const autoPublish = body?.autoPublish !== false
const autoFaceScan = body?.autoFaceScan !== false

    if (!title) {
      return NextResponse.json({ error: 'Album title is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('albums')
      .insert({
        title,
        description: description || null,
        owner_id: user.id,
        user_id: user.id,
        share_token: createShareToken(),
        status: 'active',
        is_public: true,
        allow_download: true,
        allow_original_download: false,
        download_size: 'hd',
        upload_mode: uploadMode,
        upload_size: uploadSize,
        upload_profile: uploadProfile,
        album_preset_path: albumPresetPath,
        auto_publish: autoPublish,
        auto_face_scan: autoFaceScan,
        camera_status: 'disconnected',
        camera_connection_type: 'none',
        photo_count: 0,
        total_size_bytes: 0,
        view_count: 0,
        share_count: 0,
      })
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, album: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Create album failed' },
      { status: 500 }
    )
  }
}