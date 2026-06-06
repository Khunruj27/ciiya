import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')

    if (!token) {
      return NextResponse.json({ clusters: [] })
    }

    const supabase = getSupabaseAdmin()

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id')
      .eq('share_token', token)
      .single()

    if (albumError || !album) {
      return NextResponse.json({ clusters: [] })
    }

    const { data: faces, error: facesError } = await supabase
      .from('photo_faces')
      .select(
        `
        id,
        photo_id,
        album_id,
        person_cluster_id,
        confidence,
        photos:photo_id (
          id,
          thumbnail_url,
          preview_url,
          public_url,
          original_url,
          image_url,
          filename,
          file_name
        )
      `
      )
      .eq('album_id', album.id)
      .order('created_at', { ascending: true })

    if (facesError) {
      return NextResponse.json(
        { error: facesError.message },
        { status: 500 }
      )
    }

    const grouped = new Map<
      string,
      {
        id: string
        label: string
        photo_ids: string[]
        preview_url: string | null
        count: number
      }
    >()

    for (const face of faces || []) {
      const clusterKey =
        face.person_cluster_id || `face-${face.id}`

      const photo = Array.isArray(face.photos)
        ? face.photos[0]
        : face.photos

      const imageUrl =
        photo?.thumbnail_url ||
        photo?.preview_url ||
        photo?.public_url ||
        photo?.original_url ||
        photo?.image_url ||
        null

      if (!grouped.has(clusterKey)) {
        grouped.set(clusterKey, {
          id: clusterKey,
          label: `บุคคล ${grouped.size + 1}`,
          photo_ids: [],
          preview_url: imageUrl,
          count: 0,
        })
      }

      const cluster = grouped.get(clusterKey)

      if (!cluster) continue

      if (!cluster.photo_ids.includes(face.photo_id)) {
        cluster.photo_ids.push(face.photo_id)
      }

      cluster.count = cluster.photo_ids.length

      if (!cluster.preview_url && imageUrl) {
        cluster.preview_url = imageUrl
      }
    }

    const clusters = Array.from(grouped.values()).filter(
      (cluster) => cluster.photo_ids.length > 0
    )

    return NextResponse.json({
      success: true,
      albumId: album.id,
      clusters,
    })
  } catch (error) {
    console.error('Share faces error:', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Load share faces failed',
      },
      { status: 500 }
    )
  }
}