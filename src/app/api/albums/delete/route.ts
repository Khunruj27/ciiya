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
  const albumId = String(body.albumId || '').trim()

  if (!albumId) {
    return NextResponse.json({ error: 'albumId is required' }, { status: 400 })
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

  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('album_id', albumId)
    .eq('owner_id', user.id)

  if (photosError) {
    return NextResponse.json({ error: photosError.message }, { status: 500 })
  }

  const pathsToDelete = (photos || [])
    .map((photo) => photo.storage_path)
    .filter(Boolean)

  if (pathsToDelete.length > 0) {
    const { error: storageError } = await supabase.storage
      .from('albums')
      .remove(pathsToDelete)

    if (storageError) {
      return NextResponse.json({ error: storageError.message }, { status: 500 })
    }
  }

  const { error: deleteError } = await supabase
    .from('albums')
    .delete()
    .eq('id', albumId)
    .eq('owner_id', user.id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}