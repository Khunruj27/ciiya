import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) return null

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

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    const albumId = String(body.albumId || '').trim()
    const storagePath = String(body.storagePath || '').trim()
    const fileName = String(body.fileName || '').trim()
    const fileSizeBytes = Number(body.fileSizeBytes || 0)
    const size = String(body.size || 'original').toLowerCase()
    const categoryId = body.categoryId || null

    if (!albumId || !storagePath || !fileName || !fileSizeBytes) {
      return NextResponse.json(
        { error: 'Missing required upload data' },
        { status: 400 }
      )
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, owner_id, cover_url')
      .eq('id', albumId)
      .eq('owner_id', user.id)
      .single()

    if (albumError || !album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    const { data: publicUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(storagePath)

    const publicUrl = publicUrlData.publicUrl

    const { data: insertedPhoto, error: insertError } = await supabase
      .from('photos')
      .insert({
        album_id: albumId,
        owner_id: user.id,
        filename: fileName,
        storage_path: storagePath,
        public_url: publicUrl,
        category_id: categoryId,

        file_size_bytes: fileSizeBytes,
        original_size_bytes: fileSizeBytes,
        preview_size_bytes: 0,
        thumbnail_size_bytes: 0,

        processing_status: 'pending',
        processing_progress: 0,

        original_path: storagePath,
      })
      .select('id, public_url')
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    if (!album.cover_url && insertedPhoto?.public_url) {
      await supabase
        .from('albums')
        .update({ cover_url: insertedPhoto.public_url })
        .eq('id', albumId)
        .eq('owner_id', user.id)
    }

    const supabaseAdmin = getSupabaseAdmin()

    if (!supabaseAdmin) {
      return NextResponse.json({
        success: true,
        photoId: insertedPhoto.id,
        publicUrl,
        jobQueued: false,
        jobError: 'Missing SUPABASE_SERVICE_ROLE_KEY',
      })
    }

    const { error: queueError } = await supabaseAdmin
      .from('photo_jobs')
      .insert({
        photo_id: insertedPhoto.id,
        owner_id: user.id,
        album_id: albumId,
        original_path: storagePath,
        size,
        preset_path: null,
        status: 'pending',
        priority: 100,
        retry_count: 0,
      })

    if (queueError) {
      return NextResponse.json({
        success: true,
        photoId: insertedPhoto.id,
        publicUrl,
        jobQueued: false,
        jobError: queueError.message,
      })
    }

    return NextResponse.json({
      success: true,
      photoId: insertedPhoto.id,
      publicUrl,
      jobQueued: true,
      processingStatus: 'pending',
    })
  } catch (error) {
    console.error('Finalize upload error:', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Finalize upload failed',
      },
      { status: 500 }
    )
  }
}