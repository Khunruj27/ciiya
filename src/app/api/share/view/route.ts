import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const body = await req.json()
  const token = String(body.token || '').trim()

  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }

  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select('id, view_count')
    .eq('share_token', token)
    .single()

  if (albumError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  }

  const nextCount = (album.view_count || 0) + 1

  const { error: updateError } = await supabase
    .from('albums')
    .update({ view_count: nextCount })
    .eq('id', album.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, view_count: nextCount })
}