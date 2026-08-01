import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

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

const photoId = String(body.photoId || '').trim()

    if (!photoId) {
      return NextResponse.json(
        { error: 'photoId is required' },
        { status: 400 }
      )
    }

    if (photoId.length > 100) {
  return NextResponse.json(
    { error: 'Invalid photoId' },
    { status: 400 }
  )
}

    const { data: photo, error: fetchError } = await supabase
      .from('photos')
      .select('id, view_count, created_at')
      .eq('id', photoId)
      .single()

    if (fetchError) {
  console.error(
    '[photos/view] photo lookup failed:',
    fetchError.message
  )

  return NextResponse.json(
    { error: 'Unable to update photo view' },
    { status: 500 }
  )
}

if (!photo) {
  return NextResponse.json(
    { error: 'Photo not found' },
    { status: 404 }
  )
}

    const { error: rpcError } = await supabase.rpc('increment_photo_views', {
      photo_id: photoId,
    })

    if (rpcError) {
  console.error(
    '[photos/view] increment RPC failed:',
    rpcError.message
  )

  return NextResponse.json(
    { error: 'Unable to update photo view' },
    { status: 500 }
  )
}

    const currentViewCount = Number(
  photo.view_count ?? 0
)

if (
  !Number.isSafeInteger(currentViewCount) ||
  currentViewCount < 0 ||
  currentViewCount >= Number.MAX_SAFE_INTEGER
) {
  console.error(
    '[photos/view] invalid view count:',
    photoId
  )

  return NextResponse.json(
    { error: 'Unable to update photo view' },
    { status: 500 }
  )
}

const nextView = currentViewCount + 1

let ageHours = 0

if (photo.created_at) {
  const createdAtMs = new Date(
    photo.created_at
  ).getTime()

  if (Number.isFinite(createdAtMs)) {
    ageHours = Math.max(
      0,
      (Date.now() - createdAtMs) / 3600000
    )
  } else {
    console.error(
      '[photos/view] invalid created_at:',
      photoId
    )
  }
}

const recencyBoost = Math.max(
  0,
  24 - ageHours
)

const trendingScore =
  nextView + recencyBoost

    const { error: trendingError } = await supabase
      .from('photos')
      .update({
        trending_score: trendingScore,
      })
      .eq('id', photoId)

    if (trendingError) {
  console.error(
    '[photos/view] trending score update failed:',
    trendingError.message
  )
}

    return NextResponse.json({
      success: true,
      view_count: nextView,
      trending_score: trendingScore,
    })
 } catch (error) {
  console.error(
    '[photos/view] unexpected error:',
    error
  )

  return NextResponse.json(
    { error: 'Unable to update photo view' },
    { status: 500 }
  )
}
}