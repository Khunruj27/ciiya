import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const albumId = String(req.nextUrl.searchParams.get('albumId') || '').trim()
    const from = Number(req.nextUrl.searchParams.get('from') || 0)
    const to = Number(req.nextUrl.searchParams.get('to') || 49)

    if (!albumId) {
      return NextResponse.json({ error: 'Missing albumId' }, { status: 400 })
    }

    const safeFrom = Math.max(0, from)
    const safeTo = Math.min(Math.max(safeFrom, to), safeFrom + 99)

    const { data, error } = await supabase
      .from('photos')
      .select('*')
      .eq('album_id', albumId)
      .order('created_at', { ascending: false })
      .range(safeFrom, safeTo)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      photos: data || [],
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Load photos failed',
      },
      { status: 500 }
    )
  }
}