import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { resolvePhotoDelivery } from '@/lib/storage/delivery'

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const albumId = String(body.albumId || '')
  const photoId = String(body.photoId || '')

  if (!albumId || !photoId) {
    return NextResponse.json(
      { error: 'albumId and photoId are required' },
      { status: 400 }
    )
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

  const { data: photo, error: photoError } = await supabase
    .from('photos')
    .select(
      'id, album_id, owner_id, user_id, storage_provider, storage_bucket, preview_url, thumbnail_url, preview_path, thumbnail_path, public_url, image_url'
    )
    .eq('id', photoId)
    .eq('album_id', albumId)
    .eq('owner_id', user.id)
    .single()

  if (photoError || !photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  }

  const deliveryPhoto = resolvePhotoDelivery(photo)
  const coverUrl =
    deliveryPhoto.preview_url ||
    deliveryPhoto.thumbnail_url ||
    deliveryPhoto.public_url ||
    deliveryPhoto.image_url

  if (!coverUrl) {
    return NextResponse.json(
      { error: 'Photo preview is not ready yet' },
      { status: 409 }
    )
  }

  const { error: updateError } = await supabase
    .from('albums')
    .update({ cover_photo_id: photoId, cover_url: coverUrl })
    .eq('id', albumId)
    .eq('owner_id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
