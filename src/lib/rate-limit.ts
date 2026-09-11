import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Distributed rate limiting backed by the Postgres check_rate_limit function
// (see migration 202609110003). Callers pass a bucket name and a per-window
// budget; the limiter keys on the bucket plus a caller identifier (a user id
// when known, otherwise the client IP) so one abuser can't exhaust everyone.

let admin: SupabaseClient | null = null

function getAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) return null

  if (!admin) {
    admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  return admin
}

export function getClientIp(req: Request): string {
  const headers = req.headers
  const forwarded = headers.get('x-forwarded-for')

  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    forwarded?.split(',')[0]?.trim() ||
    'unknown'
  )
}

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: number // epoch ms
  limit: number
}

type RateLimitOptions = {
  bucket: string
  limit: number
  windowSeconds: number
  // Explicit identifier (e.g. a user id); falls back to the client IP.
  identifier?: string | null
}

/**
 * Checks and consumes one unit against the given bucket. Fails OPEN — if the
 * limiter store is unreachable it returns allowed:true so an outage in rate
 * limiting never takes down the endpoint it protects.
 */
export async function rateLimit(
  req: Request,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const { bucket, limit, windowSeconds } = options
  const identifier = options.identifier || getClientIp(req)
  const key = `${bucket}:${identifier}`

  const supabase = getAdmin()

  if (!supabase) {
    return { allowed: true, remaining: limit, resetAt: Date.now(), limit }
  }

  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })

    if (error || !data) {
      console.error('[rate-limit] check failed, failing open:', error?.message)
      return { allowed: true, remaining: limit, resetAt: Date.now(), limit }
    }

    const row = Array.isArray(data) ? data[0] : data

    return {
      allowed: Boolean(row?.allowed),
      remaining: Number(row?.remaining ?? 0),
      resetAt: row?.reset_at ? new Date(row.reset_at).getTime() : Date.now(),
      limit,
    }
  } catch (err) {
    console.error(
      '[rate-limit] unexpected error, failing open:',
      err instanceof Error ? err.message : err
    )
    return { allowed: true, remaining: limit, resetAt: Date.now(), limit }
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(Math.max(result.remaining, 0)),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  }
}

/**
 * Standard 429 response for a blocked request, including Retry-After and the
 * rate-limit headers.
 */
export function tooManyRequests(
  result: RateLimitResult,
  message = 'Too many requests. Please slow down and try again shortly.'
): NextResponse {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000)
  )

  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        ...rateLimitHeaders(result),
        'Retry-After': String(retryAfterSeconds),
      },
    }
  )
}
