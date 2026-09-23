import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getCiiyaSyncAdminClient, isUuid } from '@/lib/ciiya-sync/server'
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

async function authenticatedUser() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  return { supabase, user: error ? null : user }
}

export async function GET(request: Request) {
  const { supabase, user } = await authenticatedUser()

  if (!user) {
    return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  const rate = await rateLimit(request, {
    bucket: 'ciiya-sync-devices-list',
    identifier: user.id,
    limit: 120,
    windowSeconds: 10 * 60,
  })

  if (!rate.allowed) {
    return tooManyRequests(rate, 'Device list refreshed too frequently')
  }

  const { data, error } = await supabase
    .from('ciiya_sync_devices')
    .select(
      'id,client_device_id,name,platform,app_version,scopes,token_expires_at,last_seen_at,revoked_at,created_at,updated_at'
    )
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[ciiya-sync/devices] list failed:', error.message)
    return json(
      { error: 'Unable to load devices', code: 'DEVICE_LIST_FAILED' },
      500,
      rateLimitHeaders(rate)
    )
  }

  return json(
    { success: true, devices: data || [] },
    200,
    rateLimitHeaders(rate)
  )
}

export async function DELETE(request: Request) {
  const { user } = await authenticatedUser()

  if (!user) {
    return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  const rate = await rateLimit(request, {
    bucket: 'ciiya-sync-devices-revoke',
    identifier: user.id,
    limit: 30,
    windowSeconds: 60 * 60,
  })

  if (!rate.allowed) {
    return tooManyRequests(rate, 'Too many device changes')
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

  const deviceId = String(body.deviceId || '').trim()
  if (!isUuid(deviceId)) {
    return json(
      { error: 'Invalid device', code: 'INVALID_DEVICE' },
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

  const revokedAt = new Date().toISOString()
  const { data, error } = await admin
    .from('ciiya_sync_devices')
    .update({ revoked_at: revokedAt })
    .eq('id', deviceId)
    .eq('owner_id', user.id)
    .is('revoked_at', null)
    .select('id,revoked_at')
    .maybeSingle()

  if (error) {
    console.error('[ciiya-sync/devices] revoke failed:', error.message)
    return json(
      { error: 'Unable to disconnect device', code: 'DEVICE_REVOKE_FAILED' },
      500,
      rateLimitHeaders(rate)
    )
  }

  if (!data) {
    const { data: existing, error: lookupError } = await admin
      .from('ciiya_sync_devices')
      .select('id,revoked_at')
      .eq('id', deviceId)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (lookupError) {
      return json(
        { error: 'Unable to verify device', code: 'DEVICE_LOOKUP_FAILED' },
        500,
        rateLimitHeaders(rate)
      )
    }

    if (!existing) {
      return json(
        { error: 'Device not found', code: 'DEVICE_NOT_FOUND' },
        404,
        rateLimitHeaders(rate)
      )
    }

    return json(
      {
        success: true,
        deviceId,
        revokedAt: existing.revoked_at,
        alreadyRevoked: true,
      },
      200,
      rateLimitHeaders(rate)
    )
  }

  return json(
    {
      success: true,
      deviceId: data.id,
      revokedAt: data.revoked_at,
      alreadyRevoked: false,
    },
    200,
    rateLimitHeaders(rate)
  )
}
