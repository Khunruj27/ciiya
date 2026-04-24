import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

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

    // 🔍 ดึงข้อมูลรูป
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

    // 🔢 เพิ่ม view
    const nextView = (photo.view_count || 0) + 1

    // ⏱ คำนวณอายุรูป (ชั่วโมง)
    let ageHours = 0

    if (photo.created_at) {
      ageHours =
        (Date.now() - new Date(photo.created_at).getTime()) / 3600000
    }

    // 🔥 boost รูปใหม่ (ภายใน 24 ชั่วโมง)
    const recencyBoost = Math.max(0, 24 - ageHours)

    // 🧠 สูตร trending
    const trendingScore = nextView + recencyBoost

    // 💾 update DB
    const { error: updateError } = await supabase
      .from('photos')
      .update({
        view_count: nextView,
        trending_score: trendingScore,
      })
      .eq('id', photo.id)

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
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