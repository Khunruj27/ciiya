import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const body = await req.json()
    const photoId = String(body.photoId || '').trim()

    if (!photoId) {
      return NextResponse.json(
        { error: 'photoId is required' },
        { status: 400 }
      )
    }

    const { data: photo, error: fetchError } = await supabase
      .from('photos')
      .select('id, view_count, created_at')
      .eq('id', photoId)
      .single()

    if (fetchError || !photo) {
      return NextResponse.json(
        { error: 'Photo not found' },
        { status: 404 }
      )
    }

    const { error: rpcError } = await supabase.rpc('increment_photo_views', {
      photo_id: photoId,
    })

    if (rpcError) {
      return NextResponse.json(
        { error: rpcError.message },
        { status: 500 }
      )
    }

    const nextView = Number(photo.view_count || 0) + 1

    let ageHours = 0

    if (photo.created_at) {
      ageHours =
        (Date.now() - new Date(photo.created_at).getTime()) / 3600000
    }

    const recencyBoost = Math.max(0, 24 - ageHours)
    const trendingScore = nextView + recencyBoost

    const { error: trendingError } = await supabase
      .from('photos')
      .update({
        trending_score: trendingScore,
      })
      .eq('id', photoId)

    if (trendingError) {
      return NextResponse.json(
        { error: trendingError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      view_count: nextView,
      trending_score: trendingScore,
    })
  } catch (err) {
    console.error('Photo view error:', err)

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}