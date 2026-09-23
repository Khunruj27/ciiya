import { NextResponse } from 'next/server'
import { rateLimit, rateLimitHeaders, tooManyRequests } from '@/lib/rate-limit'
import {
  CIIYA_SYNC_DEVICE_TOKEN_TTL_DAYS,
  createCiiyaSyncDeviceToken,
  getCiiyaSyncAdminClient,
  hashCiiyaSyncSecret,
  isUuid,
} from '@/lib/ciiya-sync/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PairingConsumption = {
  pairing_status: string
  paired_device_id: string | null
  paired_owner_id: string | null
  token_issued: boolean
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) || null
  if (value && typeof value === 'object') return value as T
  return null
}

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...headers,
    },
  })
}

export async function POST(request: Request) {
  const rate = await rateLimit(request, {
    bucket: 'ciiya-sync-pairing-status',
    limit: 240,
    windowSeconds: 10 * 60,
  })

  if (!rate.allowed) {
    return tooManyRequests(rate, 'Pairing status checked too frequently')
  }

  let body: Record<string, unknown>

  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json(
      { error: 'Invalid JSON body', code: 'INVALID_REQUEST' },
      400,
      rateLimitHeaders(rate)
    )
  }

  const pairingId = String(body.pairingId || '').trim()
  const pollSecret = String(body.pollSecret || '').trim()

  if (!isUuid(pairingId) || !/^[A-Za-z0-9_-]{43}$/.test(pollSecret)) {
    return json(
      { error: 'Invalid pairing credentials', code: 'INVALID_PAIRING' },
      400,
      rateLimitHeaders(rate)
    )
  }

  const admin = getCiiyaSyncAdminClient()
  if (!admin) {
    return json(
      { error: 'Ciiya Sync is not configured', code: 'SYNC_UNAVAILABLE' },
      503,
      rateLimitHeaders(rate)
    )
  }

  const deviceToken = createCiiyaSyncDeviceToken()
  const tokenExpiresAt = new Date(
    Date.now() + CIIYA_SYNC_DEVICE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data, error } = await admin.rpc('consume_ciiya_sync_pairing', {
    p_pairing_id: pairingId,
    p_poll_secret_hash: hashCiiyaSyncSecret(pollSecret),
    p_token_hash: hashCiiyaSyncSecret(deviceToken),
    p_token_expires_at: tokenExpiresAt,
  })
  const result = firstRow<PairingConsumption>(data)

  if (error || !result) {
    const code = error?.message.match(
      /(?:PAIRING_[A-Z_]+|INVALID_PAIRING_SECRET|INVALID_TOKEN_EXPIRY)/
    )?.[0]
    const status = code === 'PAIRING_NOT_FOUND' ? 404 : 409

    return json(
      {
        error: code || 'Unable to read pairing status',
        code: code || 'PAIRING_STATUS_FAILED',
      },
      status,
      rateLimitHeaders(rate)
    )
  }

  if (result.pairing_status === 'expired') {
    return json(
      { paired: false, status: 'expired', code: 'PAIRING_EXPIRED' },
      410,
      rateLimitHeaders(rate)
    )
  }

  if (result.pairing_status === 'pending') {
    return json(
      { paired: false, status: 'pending' },
      202,
      rateLimitHeaders(rate)
    )
  }

  if (!result.token_issued) {
    return json(
      {
        paired: result.pairing_status === 'consumed',
        status: result.pairing_status,
        code:
          result.pairing_status === 'consumed'
            ? 'PAIRING_ALREADY_CONSUMED'
            : undefined,
      },
      result.pairing_status === 'consumed' ? 409 : 202,
      rateLimitHeaders(rate)
    )
  }

  return json(
    {
      paired: true,
      status: 'consumed',
      deviceId: result.paired_device_id,
      ownerId: result.paired_owner_id,
      deviceToken,
      tokenType: 'Bearer',
      expiresAt: tokenExpiresAt,
      scopes: ['albums:read', 'photos:upload', 'sync:write'],
    },
    200,
    rateLimitHeaders(rate)
  )
}
