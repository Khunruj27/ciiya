import { NextResponse } from 'next/server'
import { authenticateCiiyaSyncDevice } from '@/lib/ciiya-sync/server'
import { getCiiyaSyncRolloutDecision } from '@/lib/ciiya-sync/rollout'
import { rateLimit, rateLimitHeaders, tooManyRequests } from '@/lib/rate-limit'

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

export async function GET(request: Request) {
  const authentication = await authenticateCiiyaSyncDevice(
    request,
    'albums:read'
  )

  if (!authentication) {
    return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  const { admin, device } = authentication
  const rollout = getCiiyaSyncRolloutDecision(device.owner_id)

  if (!rollout.enabled) {
    return json(
      {
        error: 'Ciiya Sync is temporarily paused',
        code: 'CIIYA_SYNC_ROLLOUT_PAUSED',
      },
      503,
      { 'Retry-After': '60' }
    )
  }

  const rate = await rateLimit(request, {
    bucket: 'ciiya-sync-albums',
    identifier: device.id,
    limit: 120,
    windowSeconds: 10 * 60,
  })

  if (!rate.allowed) {
    return tooManyRequests(rate, 'Album list refreshed too frequently')
  }

  const { data, error } = await admin
    .from('albums')
    .select(
      'id,title,description,cover_url,status,photo_count,created_at,updated_at'
    )
    .or(`owner_id.eq.${device.owner_id},user_id.eq.${device.owner_id}`)
    .neq('status', 'deleted')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[ciiya-sync/albums] load failed:', error.message)
    return json(
      { error: 'Unable to load albums', code: 'ALBUM_LIST_FAILED' },
      500,
      rateLimitHeaders(rate)
    )
  }

  return json(
    {
      success: true,
      device: {
        id: device.id,
        name: device.name,
      },
      albums: data || [],
    },
    200,
    rateLimitHeaders(rate)
  )
}
