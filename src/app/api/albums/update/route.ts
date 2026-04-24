import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const albumId = String(body.albumId || '').trim()
  const title = String(body.title || '').trim()
  const description = String(body.description || '').trim()

  if (!albumId) {
    return NextResponse.json({ error: 'albumId is required' }, { status: 400 })
  }

  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
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

  const { error: updateError } = await supabase
    .from('albums')
    .update({
      title,
      description: description || null,
    })
    .eq('id', albumId)
    .eq('owner_id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}