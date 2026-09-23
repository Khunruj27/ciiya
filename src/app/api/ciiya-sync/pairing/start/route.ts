import { NextResponse } from 'next/server'
import { rateLimit, rateLimitHeaders, tooManyRequests } from '@/lib/rate-limit'
import {
  CIIYA_SYNC_PAIRING_TTL_SECONDS,
  CIIYA_SYNC_POLL_INTERVAL_SECONDS,
  createCiiyaSyncPairingCredentials,
  getCiiyaSyncAdminClient,
  isUuid,
  normalizeCiiyaSyncDeviceName,
  normalizeCiiyaSyncPlatform,
} from '@/lib/ciiya-sync/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    bucket: 'ciiya-sync-pairing-start',
    limit: 12,
    windowSeconds: 10 * 60,
  })

  if (!rate.allowed) {
    return tooManyRequests(rate, 'Too many Ciiya Sync pairing attempts')
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

  const clientDeviceId = String(body.clientDeviceId || '').trim()
  const deviceName = normalizeCiiyaSyncDeviceName(body.deviceName)
  const platform = normalizeCiiyaSyncPlatform(body.platform)
  const appVersion = String(body.appVersion || '').trim().slice(0, 40) || null

  if (!isUuid(clientDeviceId) || !deviceName) {
    return json(
      { error: 'Invalid device details', code: 'INVALID_DEVICE' },
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

  const expiresAt = new Date(
    Date.now() + CIIYA_SYNC_PAIRING_TTL_SECONDS * 1000
  ).toISOString()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const credentials = createCiiyaSyncPairingCredentials()
    const { data, error } = await admin
      .from('ciiya_sync_pairings')
      .insert({
        client_device_id: clientDeviceId,
        user_code_hash: credentials.userCodeHash,
        poll_secret_hash: credentials.pollSecretHash,
        device_name: deviceName,
        platform,
        app_version: appVersion,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('id')
      .single()

    if (error?.code === '23505') continue

    if (error || !data) {
      console.error('[ciiya-sync/pairing/start] create failed:', error?.message)
      return json(
        { error: 'Unable to start pairing', code: 'PAIRING_CREATE_FAILED' },
        500,
        rateLimitHeaders(rate)
      )
    }

    const verificationUrl = new URL('/connect/ciiya-sync', request.url)
    verificationUrl.searchParams.set('code', credentials.formattedUserCode)

    return json(
      {
        success: true,
        pairingId: data.id,
        userCode: credentials.formattedUserCode,
        pollSecret: credentials.pollSecret,
        verificationUri: verificationUrl.origin + verificationUrl.pathname,
        verificationUriComplete: verificationUrl.toString(),
        expiresAt,
        expiresIn: CIIYA_SYNC_PAIRING_TTL_SECONDS,
        interval: CIIYA_SYNC_POLL_INTERVAL_SECONDS,
      },
      201,
      rateLimitHeaders(rate)
    )
  }

  return json(
    { error: 'Unable to allocate pairing code', code: 'PAIRING_CODE_CONFLICT' },
    503,
    rateLimitHeaders(rate)
  )
}
