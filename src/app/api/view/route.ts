import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const body = await req.json()
    const photoId = String(body.photoId || '').trim()

    if (!photoId) {
      return NextResponse.json({ error: 'photoId required' }, { status: 400 })
    }

    const { error } = await supabase.rpc('increment_photo_view', {
      photo_id: photoId,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}