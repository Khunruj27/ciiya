import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8 * 1024
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 20

type RateRecord = { startedAt: number; count: number }
const rates = new Map<string, RateRecord>()

function clean(value: unknown, maxLength: number) {
  return String(value || '')
    .replace(/([?&](?:token|code|secret|key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/bearer\s+[a-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, maxLength)
}

function getClientKey(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

function isRateLimited(key: string) {
  const now = Date.now()
  const current = rates.get(key)

  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rates.set(key, { startedAt: now, count: 1 })
    return false
  }

  current.count += 1
  return current.count > RATE_LIMIT
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const requestHost =
    req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host
  let originHost = ''

  try {
    originHost = origin ? new URL(origin).host : ''
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (originHost && originHost !== requestHost) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  const clientKey = getClientKey(req)
  if (isRateLimited(clientKey)) {
    return NextResponse.json({ error: 'Too many reports' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid report' }, { status: 400 })
  }

  const message = clean((body as { message?: unknown }).message, 600)
  if (!message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  const event = {
    source: 'browser',
    level: 'error',
    timestamp: new Date().toISOString(),
    message,
    name: clean((body as { name?: unknown }).name, 100),
    stack: clean((body as { stack?: unknown }).stack, 2_000),
    file: clean((body as { source?: unknown }).source, 300),
    line: Number((body as { line?: unknown }).line || 0) || undefined,
    column: Number((body as { column?: unknown }).column || 0) || undefined,
    route: clean((body as { route?: unknown }).route, 300).split('?')[0],
    userAgent: clean(req.headers.get('user-agent'), 300),
  }

  console.error('[ciiya-client-monitor]', JSON.stringify(event))

  return new NextResponse(null, {
    status: 202,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
