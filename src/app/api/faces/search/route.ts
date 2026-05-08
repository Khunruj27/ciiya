import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FACES_TO_SCAN = 5000
const DEFAULT_RESULT_LIMIT = 80
const MAX_RESULT_LIMIT = 200
const MATCH_THRESHOLD = 0.6

const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 20

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
}

type RateLimitEntry = {
  count: number
  resetAt: number
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
    const descriptor = body.descriptor as number[]

    const rawLimit = Number(body.limit || DEFAULT_RESULT_LIMIT)
    const resultLimit = Math.min(Math.max(rawLimit, 1), MAX_RESULT_LIMIT)

    if (!albumId || !Array.isArray(descriptor) || descriptor.length === 0) {
      return NextResponse.json(
        { error: 'albumId and descriptor are required' },
        {
          status: 400,
          headers: rateLimitHeaders(rate),
        }
      )
    }

    const supabase = getSupabaseAdmin()

    const { data: faces, error } = await supabase
      .from('photo_faces')
      .select(
        `
        id,
        photo_id,
        album_id,
        descriptor,
        photos (
          id,
          public_url,
          preview_url,
          thumbnail_url,
          filename
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

    const results = (faces || [])
      .map((face: any) => {
        const targetDescriptor = Array.isArray(face.descriptor)
          ? face.descriptor
          : []

        const score = distance(descriptor, targetDescriptor)

        return {
          faceId: face.id,
          photoId: face.photo_id,
          albumId: face.album_id,
          score,
          confidence: confidenceFromScore(score),
          photo: face.photos,
        }
      })
      .filter((item) => Number.isFinite(item.score))
      .filter((item) => item.score <= MATCH_THRESHOLD)
      .sort((a, b) => a.score - b.score)
      .slice(0, resultLimit)

    return NextResponse.json(
      {
        success: true,
        count: results.length,
        scanned: faces?.length || 0,
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