import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const body = await req.json()

    const token = String(body.token || '').trim()

    if (!token) {
      return NextResponse.json(
        {
          error: 'token is required',
        },
        {
          status: 400,
        }
      )
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, view_count')
      .eq('share_token', token)
      .single()

    if (albumError || !album) {
      return NextResponse.json(
        {
          error: 'Album not found',
        },
        {
          status: 404,
        }
      )
    }

    const { error: rpcError } = await supabase.rpc(
      'increment_album_views',
      {
        album_id: album.id,
      }
    )

    if (rpcError) {
      return NextResponse.json(
        {
          error: rpcError.message,
        },
        {
          status: 500,
        }
      )
    }

    return NextResponse.json({
      success: true,
      view_count: Number(album.view_count || 0) + 1,
    })
  } catch (error) {
    console.error('Share view error:', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error',
      },
      {
        status: 500,
      }
    )
  }
}