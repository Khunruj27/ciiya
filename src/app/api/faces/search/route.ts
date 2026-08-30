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

const MAX_FACES_TO_SCAN = 5000
const DEFAULT_RESULT_LIMIT = 80
const MAX_RESULT_LIMIT = 200
const MATCH_THRESHOLD = Number(process.env.FACE_SEARCH_THRESHOLD || 0.55)

const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 20

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
}

type RateLimitEntry = {
  count: number
  resetAt: number
}

type PhotoRecord = {
  id?: string | null
  public_url?: string | null
  preview_url?: string | null
  thumbnail_url?: string | null
  image_url?: string | null
  filename?: string | null
  file_name?: string | null
}

type FaceRecord = {
  id: string
  photo_id: string
  album_id: string
  descriptor?: unknown
  confidence?: number | null
  box_x?: number | null
  box_y?: number | null
  box_width?: number | null
  box_height?: number | null
  photos?: PhotoRecord | PhotoRecord[] | null
}

const rateLimitStore = new Map<string, RateLimitEntry>()

function getClientIp(req: NextRequest) {
  const forwardedFor = req.headers.get('x-forwarded-for')
  const realIp = req.headers.get('x-real-ip')
  const cfIp = req.headers.get('cf-connecting-ip')

  if (cfIp) return cfIp
  if (realIp) return realIp

  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown'
  }

  return 'unknown'
}

function checkRateLimit(req: NextRequest) {
  const ip = getClientIp(req)
  const now = Date.now()
  const current = rateLimitStore.get(ip)

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    })

    return {
      allowed: true,
      ip,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    }
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      ip,
      remaining: 0,
      resetAt: current.resetAt,
    }
  }

  current.count += 1
  rateLimitStore.set(ip, current)

  return {
    allowed: true,
    ip,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - current.count),
    resetAt: current.resetAt,
  }
}

function rateLimitHeaders(rate: ReturnType<typeof checkRateLimit>) {
  return {
    ...NO_STORE_HEADERS,
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
    'X-RateLimit-Remaining': String(rate.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rate.resetAt / 1000)),
  }
}

function cleanupRateLimitStore() {
  const now = Date.now()

  for (const [ip, value] of rateLimitStore.entries()) {
    if (value.resetAt <= now) {
      rateLimitStore.delete(ip)
    }
  }
}

function normalizeDescriptor(value: unknown): number[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
}

function distance(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length)

  if (!length) return Number.POSITIVE_INFINITY

  let sum = 0

  for (let i = 0; i < length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }

  return Math.sqrt(sum)
}

function confidenceFromScore(score: number) {
  return Math.max(0, Math.min(100, Math.round((1 - score) * 100)))
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req)

  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: 'Too many face search requests. Please try again shortly.',
      },
      {
        status: 429,
        headers: rateLimitHeaders(rate),
      }
    )
  }

  cleanupRateLimitStore()

  try {
    const body = await req.json()

    const albumId = String(body.albumId || '').trim()
    const token = String(body.token || '').trim()
    const descriptor = normalizeDescriptor(body.descriptor)

    const rawLimit = Number(body.limit || DEFAULT_RESULT_LIMIT)
    const resultLimit = Math.min(Math.max(rawLimit, 1), MAX_RESULT_LIMIT)

    if (!albumId) {
      return NextResponse.json(
        { error: 'albumId is required' },
        {
          status: 400,
          headers: rateLimitHeaders(rate),
        }
      )
    }

    if (!token) {
      return NextResponse.json(
        { error: 'share token is required' },
        {
          status: 400,
          headers: rateLimitHeaders(rate),
        }
      )
    }

    if (descriptor.length === 0) {
      return NextResponse.json(
        { error: 'descriptor is required' },
        {
          status: 400,
          headers: rateLimitHeaders(rate),
        }
      )
    }

    if (descriptor.length !== 128) {
  return NextResponse.json(
    { error: 'invalid descriptor length' },
    {
      status: 400,
      headers: rateLimitHeaders(rate),
    }
  )
}

    const supabase = getSupabaseAdmin()

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select(
        'id, owner_id, user_id, share_token, is_public, status, is_password_protected, password_hash'
      )
      .eq('id', albumId)
      .eq('share_token', token)
      .maybeSingle()

    if (albumError || !album || !isAlbumPubliclyVisible(album)) {
      return NextResponse.json(
        { error: 'Invalid share link' },
        {
          status: 404,
          headers: rateLimitHeaders(rate),
        }
      )
    }

    const shareCookie = req.cookies.get(
      getShareAuthCookieName(album.id)
    )?.value

    if (!hasValidSharePasswordAccess(album, shareCookie)) {
      return NextResponse.json(
        { error: 'Password required' },
        {
          status: 401,
          headers: rateLimitHeaders(rate),
        }
      )
    }

    const { data: facesData, error } = await supabase
      .from('photo_faces')
      .select(
        `
        id,
        photo_id,
        album_id,
        descriptor,
        confidence,
        box_x,
        box_y,
        box_width,
        box_height,
        photos:photo_id (
          id,
          public_url,
          preview_url,
          thumbnail_url,
          image_url,
          filename,
          file_name
        )
      `
      )
      .eq('album_id', albumId)
      .not('descriptor', 'is', null)
      .order('created_at', { ascending: false })
      .limit(MAX_FACES_TO_SCAN)

    if (error) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 500,
          headers: rateLimitHeaders(rate),
        }
      )
    }

    const faces = (facesData || []) as FaceRecord[]
    const seenPhotoIds = new Set<string>()

    const results = faces
      .map((face) => {
        const targetDescriptor = normalizeDescriptor(face.descriptor)
        const score = distance(descriptor, targetDescriptor)

        const photo = Array.isArray(face.photos)
          ? face.photos[0]
          : face.photos

        const imageUrl =
          photo?.preview_url ||
          photo?.public_url ||
          photo?.image_url ||
          null

        const thumbnailUrl =
          photo?.thumbnail_url ||
          photo?.preview_url ||
          photo?.public_url ||
          photo?.image_url ||
          null

        return {
          faceId: face.id,
          photoId: face.photo_id,
          albumId: face.album_id,
          score,
          confidence: confidenceFromScore(score),
          faceConfidence: Number(face.confidence || 0),
          box: {
            x: Number(face.box_x || 0),
            y: Number(face.box_y || 0),
            width: Number(face.box_width || 0),
            height: Number(face.box_height || 0),
          },
          photo: {
            id: photo?.id,
            filename: photo?.filename || photo?.file_name || 'photo',
            public_url: photo?.public_url || null,
            preview_url: photo?.preview_url || null,
            thumbnail_url: photo?.thumbnail_url || null,
            image_url: imageUrl,
            thumbnailUrl,
            imageUrl,
          },
        }
      })
      .filter((item) => Number.isFinite(item.score))
      .filter((item) => item.score <= MATCH_THRESHOLD)
      .sort((a, b) => a.score - b.score)
      .filter((item) => {
        if (seenPhotoIds.has(item.photoId)) return false
        seenPhotoIds.add(item.photoId)
        return true
      })
      .slice(0, resultLimit)

    await recordShareEvent(supabase, {
      albumId: album.id,
      ownerId: album.owner_id || album.user_id,
      eventType: 'face_search',
      metadata: { match_count: results.length },
    })

    return NextResponse.json(
      {
        success: true,
        count: results.length,
        scanned: faces.length,
        threshold: MATCH_THRESHOLD,
        results,
      },
      {
        headers: rateLimitHeaders(rate),
      }
    )
  } catch (error) {
    console.error('Face search error:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Face search failed',
      },
      {
        status: 500,
        headers: rateLimitHeaders(rate),
      }
    )
  }
}
