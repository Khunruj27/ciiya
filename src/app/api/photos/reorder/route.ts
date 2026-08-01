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

const body = await req.json().catch(() => null)

if (
  !body ||
  typeof body !== 'object' ||
  Array.isArray(body)
) {
  return NextResponse.json(
    { error: 'Invalid request body' },
    { status: 400 }
  )
}

const albumId = String(body.albumId || '').trim()
const items = Array.isArray(body.items) ? body.items : []

    if (!albumId) {
      return NextResponse.json({ error: 'albumId is required' }, { status: 400 })
    }

    if (albumId.length > 100) {
  return NextResponse.json(
    { error: 'Invalid albumId' },
    { status: 400 }
  )
}

    if (!items.length) {
      return NextResponse.json({ error: 'items are required' }, { status: 400 })
    }

    if (items.length > 5000) {
  return NextResponse.json(
    { error: 'Too many items' },
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

const normalizedItems: Array<{
  photoId: string
  position: number
}> = []

const seenPhotoIds = new Set<string>()
const seenPositions = new Set<number>()

for (const item of items) {
  const photoId = String(item?.id || '').trim()
  const position = Number(item?.position)

  if (
    !photoId ||
    photoId.length > 100 ||
    !Number.isSafeInteger(position) ||
    position < 0
  ) {
    return NextResponse.json(
      { error: 'Invalid reorder item' },
      { status: 400 }
    )
  }

if (
  seenPhotoIds.has(photoId) ||
  seenPositions.has(position)
) {
  return NextResponse.json(
    { error: 'Duplicate reorder item' },
    { status: 400 }
  )
}

seenPhotoIds.add(photoId)
seenPositions.add(position)

  normalizedItems.push({
    photoId,
    position,
  })
}

for (const item of normalizedItems) {
  const { data: updatedPhoto, error } = await supabase
    .from('photos')
    .update({
      position: item.position,
    })
    .eq('id', item.photoId)
    .eq('album_id', albumId)
    .eq('owner_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(
      '[photos/reorder] update failed:',
      error.message
    )

    return NextResponse.json(
      { error: 'Reorder failed' },
      { status: 500 }
    )
  }

  if (!updatedPhoto) {
    return NextResponse.json(
      { error: 'Photo not found in album' },
      { status: 400 }
    )
  }
}

return NextResponse.json({ success: true })
} catch (error) {
  console.error('[photos/reorder] error:', error)

  return NextResponse.json(
    { error: 'Reorder failed' },
    { status: 500 }
  )
}
}