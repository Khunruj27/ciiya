import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VIEW_COOKIE_MAX_AGE = 60 * 60 * 6

function makeViewCookieName(token: string) {
  return `ciiya_viewed_${token.slice(0, 24)}`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const body = await req.json().catch(() => null)

    const token = String(body?.token || '').trim()

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: 'token is required',
        },
        {
          status: 400,
        }
      )
    }

    const cookieName = makeViewCookieName(token)
    const alreadyViewed = req.cookies.get(cookieName)?.value === '1'

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, view_count')
      .eq('share_token', token)
      .maybeSingle()

    if (albumError || !album) {
      return NextResponse.json(
        {
          success: false,
          error: albumError?.message || 'Album not found',
        },
        {
          status: 404,
        }
      )
    }

    const currentViewCount = Number(album.view_count || 0)

    if (alreadyViewed) {
      return NextResponse.json({
        success: true,
        view_count: currentViewCount,
        counted: false,
        mode: 'cookie-skip',
      })
    }

    const nextViewCount = currentViewCount + 1

    const { error: rpcError } = await supabase.rpc('increment_album_views', {
      album_id: album.id,
    })

    let mode: 'rpc' | 'fallback' | 'skipped' = 'rpc'
    let warning: string | null = null

    if (rpcError) {
      console.warn('[share/view] RPC fallback:', rpcError.message)

      const { error: updateError } = await supabase
        .from('albums')
        .update({
          view_count: nextViewCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', album.id)

      if (updateError) {
        console.warn('[share/view] fallback update failed:', updateError.message)
        mode = 'skipped'
        warning = updateError.message
      } else {
        mode = 'fallback'
      }
    }

    const response = NextResponse.json({
      success: true,
      view_count: nextViewCount,
      counted: mode !== 'skipped',
      mode,
      warning,
    })

    response.cookies.set(cookieName, '1', {
      maxAge: VIEW_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Share view error:', error)

    return NextResponse.json({
      success: true,
      view_count: null,
      counted: false,
      mode: 'ignored',
      warning:
        error instanceof Error ? error.message : 'Share view failed but ignored',
    })
  }
}