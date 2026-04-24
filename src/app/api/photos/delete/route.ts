import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const photoId = String(body.photoId || '').trim()

  if (!photoId) {
    return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
  }

  const { data: photo, error: photoError } = await supabase
    .from('photos')
    .select('id, album_id, owner_id, storage_path')
    .eq('id', photoId)
    .eq('owner_id', user.id)
    .single()

  if (photoError || !photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  }

  const { data: albumsUsingCover } = await supabase
    .from('albums')
    .select('id')
    .eq('cover_photo_id', photoId)
    .eq('owner_id', user.id)

  if (albumsUsingCover && albumsUsingCover.length > 0) {
    const albumIds = albumsUsingCover.map((album) => album.id)

    const { error: coverResetError } = await supabase
      .from('albums')
      .update({ cover_photo_id: null })
      .in('id', albumIds)
      .eq('owner_id', user.id)

    if (coverResetError) {
      return NextResponse.json(
        { error: coverResetError.message },
        { status: 500 }
      )
    }
  }

  const { error: storageError } = await supabase.storage
    .from('albums')
    .remove([photo.storage_path])

  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 })
  }

  const { error: deleteError } = await supabase
    .from('photos')
    .delete()
    .eq('id', photoId)
    .eq('owner_id', user.id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}