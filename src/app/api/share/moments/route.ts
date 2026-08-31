import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'
import { recordShareEvent, removeShareEvent } from '@/lib/share-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STORAGE_BUCKET = 'guest-moments'
const MAX_FILES = 4
const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_REQUEST_BYTES = 34 * 1024 * 1024
const MAX_RECENT_POSTS = 6
const RATE_WINDOW_MS = 15 * 60 * 1000

type AllowedMimeType = 'image/jpeg' | 'image/png' | 'image/webp'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) throw new Error('Missing Supabase env')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getMimeType(value: string): AllowedMimeType | null {
  const mime = value.trim().toLowerCase()
  if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') {
    return mime
  }
  return null
}

function hasValidImageSignature(buffer: Buffer, mime: AllowedMimeType) {
  if (mime === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }

  if (mime === 'image/png') {
    return buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  }

  return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
}

// One-way visitor key. Likes pass the anonymous browser id (stable per
// browser, immune to carrier CGNAT collisions); posting rate-limits omit it so
// they stay tied to IP + user agent, which a reset id cannot dodge.
function getGuestKey(req: NextRequest, albumId: string, guestId?: string) {
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

export async function GET(req: NextRequest) {
  try {
    const token = String(req.nextUrl.searchParams.get('token') || '').trim()
    if (!token) return NextResponse.json({ error: 'Share token is required' }, { status: 400 })

    const access = await getAlbum(req, token)
    if (!access) return NextResponse.json({ error: 'Shared album not found' }, { status: 404 })

    const { data, error } = await access.supabase
      .from('guest_moments')
      .select('id, guest_name, message, image_urls, like_count, created_at')
      .eq('album_id', access.album.id)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw new Error(error.message)

    return NextResponse.json(
      { success: true, moments: data || [] },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    )
  } catch (error) {
    console.error('[share/moments] load failed:', error)
    return NextResponse.json({ error: 'Unable to load guest moments' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const uploadedPaths: string[] = []

  try {
    const contentLength = Number(req.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: 'The selected photos exceed the 32MB total upload limit.' },
        { status: 413 }
      )
    }

    let formData: FormData

    try {
      formData = await req.formData()
    } catch (error) {
      console.error('[share/moments] unable to parse multipart request:', error)
      return NextResponse.json(
        { error: 'The upload was incomplete. Please choose the photos again and retry.' },
        { status: 400 }
      )
    }

    const token = String(formData.get('token') || '').trim()
    const guestName = String(formData.get('guestName') || '').trim().slice(0, 60)
    const message = String(formData.get('message') || '').trim().slice(0, 280)
    const files = formData.getAll('files').filter((value): value is File => value instanceof File)

    if (!token) return NextResponse.json({ error: 'Share token is required' }, { status: 400 })
    if (!guestName) return NextResponse.json({ error: 'Please enter your name' }, { status: 400 })
    if (files.length < 1 || files.length > MAX_FILES) {
      return NextResponse.json({ error: `Choose between 1 and ${MAX_FILES} photos` }, { status: 400 })
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_TOTAL_BYTES || files.some((file) => file.size <= 0 || file.size > MAX_FILE_BYTES)) {
      return NextResponse.json({ error: 'Photos are too large. Maximum 12MB per photo.' }, { status: 400 })
    }

    const access = await getAlbum(req, token)
    if (!access) return NextResponse.json({ error: 'Shared album not found' }, { status: 404 })

    const guestKeyHash = getGuestKey(req, access.album.id)
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
    const { count, error: rateError } = await access.supabase
      .from('guest_moments')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', access.album.id)
      .eq('guest_key_hash', guestKeyHash)
      .gte('created_at', since)

    if (rateError) throw new Error(rateError.message)
    if ((count || 0) >= MAX_RECENT_POSTS) {
      return NextResponse.json({ error: 'You have shared several moments. Please try again later.' }, { status: 429 })
    }

    const sources: Buffer[] = []
    for (const file of files) {
      const mime = getMimeType(file.type)
      if (!mime) return NextResponse.json({ error: 'Only JPEG, PNG and WEBP photos are allowed' }, { status: 400 })

      const source = Buffer.from(await file.arrayBuffer())
      if (source.length !== file.size || !hasValidImageSignature(source, mime)) {
        return NextResponse.json({ error: 'One of the photos is invalid or corrupted' }, { status: 400 })
      }

      sources.push(source)
    }

    const imageUrls: string[] = []

    for (const source of sources) {
      const optimized = await sharp(source, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86, progressive: true, mozjpeg: true })
        .toBuffer()

      const path = `${access.album.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`
      const { error: uploadError } = await access.supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, optimized, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: false,
        })

      if (uploadError) throw new Error(uploadError.message)
      uploadedPaths.push(path)

      const { data: publicUrl } = access.supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
      imageUrls.push(publicUrl.publicUrl)
    }

    const { data: moment, error: insertError } = await access.supabase
      .from('guest_moments')
      .insert({
        album_id: access.album.id,
        guest_name: guestName,
        message: message || null,
        image_urls: imageUrls,
        storage_paths: uploadedPaths,
        guest_key_hash: guestKeyHash,
        status: 'published',
      })
      .select('id, guest_name, message, image_urls, like_count, created_at')
      .single()

    if (insertError) throw new Error(insertError.message)

    await recordShareEvent(access.supabase, {
      albumId: access.album.id,
      ownerId: access.album.owner_id || access.album.user_id,
      eventType: 'moment_created',
      guestKeyHash,
      metadata: {
        guest_name: guestName,
        photo_count: imageUrls.length,
        moment_id: moment.id,
      },
    })

    return NextResponse.json({ success: true, moment }, { status: 201 })
  } catch (error) {
    console.error('[share/moments] upload failed:', error)

    if (uploadedPaths.length > 0) {
      try {
        await getSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(uploadedPaths)
      } catch {}
    }

    return NextResponse.json({ error: 'Unable to share this moment. Please try again.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = String(body?.token || '').trim()
    const momentId = String(body?.momentId || '').trim()
    const guestId = String(body?.guestId || '').trim()

    if (!token || !momentId) {
      return NextResponse.json({ error: 'Share token and moment are required' }, { status: 400 })
    }

    const access = await getAlbum(req, token)
    if (!access) return NextResponse.json({ error: 'Shared album not found' }, { status: 404 })

    const { data: moment, error: momentError } = await access.supabase
      .from('guest_moments')
      .select('id')
      .eq('id', momentId)
      .eq('album_id', access.album.id)
      .eq('status', 'published')
      .maybeSingle()

    if (momentError) throw new Error(momentError.message)
    if (!moment) return NextResponse.json({ error: 'Moment not found' }, { status: 404 })

    const guestKeyHash = getGuestKey(req, access.album.id, guestId)
    const { data, error } = await access.supabase.rpc('toggle_guest_moment_like', {
      p_moment_id: momentId,
      p_guest_key_hash: guestKeyHash,
    })

    if (error) throw new Error(error.message)

    const result = Array.isArray(data) ? data[0] : data

    if (result?.liked) {
      await recordShareEvent(access.supabase, {
        albumId: access.album.id,
        ownerId: access.album.owner_id || access.album.user_id,
        eventType: 'moment_like',
        guestKeyHash,
        metadata: { moment_id: momentId },
      })
    } else {
      // Unliking takes the notification back down.
      await removeShareEvent(access.supabase, {
        albumId: access.album.id,
        eventType: 'moment_like',
        momentId,
        guestKeyHash,
      })
    }

    return NextResponse.json({
      success: true,
      liked: Boolean(result?.liked),
      likeCount: Number(result?.total || 0),
    })
  } catch (error) {
    console.error('[share/moments] like failed:', error)
    return NextResponse.json({ error: 'Unable to update this reaction' }, { status: 500 })
  }
}
