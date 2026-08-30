import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'
import { recordShareEvent } from '@/lib/share-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// A one-way per-visitor key — never a raw id, IP, or user agent. It prefers
// the anonymous browser id the client sends (stable per browser, unaffected by
// carrier CGNAT), and only falls back to IP + user agent when a client did not
// provide one.
function getGuestKey(
  req: NextRequest,
  albumId: string,
  guestId?: string
) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'ciiya'

  const trimmed = (guestId || '').trim()
  const basis =
    trimmed.length >= 8 && trimmed.length <= 100
      ? `id:${trimmed}`
      : `ipua:${
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          req.headers.get('x-real-ip') ||
          'unknown'
        }:${req.headers.get('user-agent') || 'unknown'}`

  return crypto
    .createHmac('sha256', secret)
    .update(`${albumId}:${basis}`)
    .digest('hex')
}

async function getAlbum(req: NextRequest, token: string) {
  const supabase = getSupabaseAdmin()
  const { data: album, error } = await supabase
    .from('albums')
    .select('id, owner_id, user_id, is_public, status, is_password_protected, password_hash')
    .eq('share_token', token)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!album || !isAlbumPubliclyVisible(album)) return null

  const shareCookie = req.cookies.get(getShareAuthCookieName(album.id))?.value
  if (!hasValidSharePasswordAccess(album, shareCookie)) return null

  return { album, supabase }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const token = String(body.token || '').trim()
    const photoId = String(body.photoId || '').trim()
    const guestId = String(body.guestId || '').trim()

    if (!token || !photoId) {
      return NextResponse.json(
        { error: 'token and photoId are required' },
        { status: 400 }
      )
    }

    const access = await getAlbum(req, token)
    if (!access) {
      return NextResponse.json({ error: 'Shared album not found' }, { status: 404 })
    }

    // The photo must belong to this album, so a share token can only react to
    // its own gallery.
    const { data: photo } = await access.supabase
      .from('photos')
      .select('id, album_id')
      .eq('id', photoId)
      .eq('album_id', access.album.id)
      .maybeSingle()

    if (!photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    const guestKeyHash = getGuestKey(req, access.album.id, guestId)

    const { data, error } = await access.supabase.rpc('toggle_photo_like', {
      p_photo_id: photoId,
      p_guest_key_hash: guestKeyHash,
    })

    if (error) throw new Error(error.message)

    const result = Array.isArray(data) ? data[0] : data

    if (result?.liked) {
      await recordShareEvent(access.supabase, {
        albumId: access.album.id,
        ownerId: access.album.owner_id || access.album.user_id,
        photoId,
        eventType: 'photo_like',
        guestKeyHash,
      })
    }

    return NextResponse.json(
      {
        success: true,
        liked: Boolean(result?.liked),
        likeCount: Number(result?.total || 0),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    )
  } catch (error) {
    console.error('[share/photo-likes] toggle failed:', error)
    return NextResponse.json(
      { error: 'Unable to update this reaction' },
      { status: 500 }
    )
  }
}
