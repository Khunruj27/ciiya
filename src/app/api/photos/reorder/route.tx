import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function PATCH(req: NextRequest) {
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
    const items = Array.isArray(body.items) ? body.items : []

    if (!albumId) {
      return NextResponse.json({ error: 'albumId is required' }, { status: 400 })
    }

    if (!items.length) {
      return NextResponse.json({ error: 'items are required' }, { status: 400 })
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, owner_id')
      .eq('id', albumId)
      .eq('owner_id', user.id)
      .single()

    if (albumError || !album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    for (const item of items) {
      const photoId = String(item.id || '').trim()
      const position = Number(item.position)

      if (!photoId || Number.isNaN(position)) continue

      const { error } = await supabase
        .from('photos')
        .update({ position })
        .eq('id', photoId)
        .eq('album_id', albumId)
        .eq('owner_id', user.id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reorder failed' },
      { status: 500 }
    )
  }
}