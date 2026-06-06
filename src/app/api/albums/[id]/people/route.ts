import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = {
  params: Promise<{ id: string }>
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

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id: albumId } = await params
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, owner_id, user_id')
      .eq('id', albumId)
      .or(`owner_id.eq.${user.id},user_id.eq.${user.id}`)
      .maybeSingle()

    if (albumError || !album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    const { data: clusters, error } = await supabaseAdmin
      .from('face_clusters')
      .select(
        `
        id,
        album_id,
        owner_id,
        label,
        preview_photo_id,
        face_count,
        created_at,
        updated_at
        `
      )
      .eq('album_id', albumId)
      .order('face_count', { ascending: false })
      .limit(100)

    if (error) {
      throw new Error(error.message)
    }

    const previewPhotoIds = (clusters || [])
      .map((cluster) => cluster.preview_photo_id)
      .filter(Boolean)

    const { data: previewPhotos } =
      previewPhotoIds.length > 0
        ? await supabaseAdmin
            .from('photos')
            .select(
              `
              id,
              filename,
              public_url,
              preview_url,
              thumbnail_url,
              blur_data_url
              `
            )
            .in('id', previewPhotoIds)
        : { data: [] }

    const photoMap = new Map(
      (previewPhotos || []).map((photo) => [photo.id, photo])
    )

    const people = (clusters || []).map((cluster) => ({
      ...cluster,
      preview_photo: cluster.preview_photo_id
        ? photoMap.get(cluster.preview_photo_id) || null
        : null,
    }))

    return NextResponse.json({
      success: true,
      people,
      count: people.length,
    })
  } catch (error) {
    console.error('[album people] fatal:', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Load people failed',
      },
      { status: 500 }
    )
  }
}