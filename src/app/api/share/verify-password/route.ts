import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import {
  getShareAuthCookieName,
  isAlbumPubliclyVisible,
  signShareAuthToken,
} from '@/lib/share-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) return null

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)

    const token = String(body?.token || '').trim()
    const password = String(body?.password || '')

    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    if (!supabase) {
      return NextResponse.json(
        { error: 'Server misconfigured' },
        { status: 500 }
      )
    }

    const { data: album, error } = await supabase
      .from('albums')
      .select('id, is_public, status, is_password_protected, password_hash')
      .eq('share_token', token)
      .maybeSingle()

    if (error || !album || !isAlbumPubliclyVisible(album)) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    if (!album.is_password_protected || !album.password_hash) {
      return NextResponse.json({ success: true, required: false })
    }

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      )
    }

    const matches = await bcrypt.compare(password, album.password_hash)

    if (!matches) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
    }

    const authToken = signShareAuthToken(album.id, album.password_hash)

    const response = NextResponse.json({ success: true, required: true })

    response.cookies.set(getShareAuthCookieName(album.id), authToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    return response
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Verify password failed',
      },
      { status: 500 }
    )
  }
}
