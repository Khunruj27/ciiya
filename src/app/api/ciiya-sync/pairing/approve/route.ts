import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { rateLimit, rateLimitHeaders, tooManyRequests } from '@/lib/rate-limit'
import {
  getCiiyaSyncAdminClient,
  hashCiiyaSyncSecret,
  normalizeCiiyaSyncUserCode,
} from '@/lib/ciiya-sync/server'
import { getCiiyaSyncRolloutDecision } from '@/lib/ciiya-sync/rollout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PairingApproval = {
  pairing_id: string
  pairing_status: string
  device_name: string
  device_platform: string
  pairing_expires_at: string
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
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  const rollout = getCiiyaSyncRolloutDecision(user.id)

  if (!rollout.enabled) {
    return json(
      {
        error: 'Ciiya Sync is not available for this account yet',
        code: 'CIIYA_SYNC_ROLLOUT_DISABLED',
      },
      403
    )
  }

  const rate = await rateLimit(request, {
    bucket: 'ciiya-sync-pairing-approve',
    identifier: user.id,
    limit: 12,
    windowSeconds: 10 * 60,
  })

  if (!rate.allowed) {
    return tooManyRequests(rate, 'Too many pairing-code attempts')
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

  const userCode = normalizeCiiyaSyncUserCode(body.userCode)
  if (!userCode) {
    return json(
      { error: 'Invalid pairing code', code: 'INVALID_PAIRING_CODE' },
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

  const { data, error } = await admin.rpc('approve_ciiya_sync_pairing', {
    p_user_code_hash: hashCiiyaSyncSecret(userCode),
    p_owner_id: user.id,
  })
  const approval = firstRow<PairingApproval>(data)

  if (error || !approval) {
    const code = error?.message.match(
      /(?:PAIRING_[A-Z_]+|INVALID_PAIRING_CODE|OWNER_NOT_FOUND)/
    )?.[0]
    const status = code === 'PAIRING_NOT_FOUND' ? 404 : 409

    return json(
      {
        error: code || 'Unable to approve pairing',
        code: code || 'PAIRING_APPROVAL_FAILED',
      },
      status,
      rateLimitHeaders(rate)
    )
  }

  if (approval.pairing_status === 'expired') {
    return json(
      { error: 'Pairing code expired', code: 'PAIRING_EXPIRED' },
      410,
      rateLimitHeaders(rate)
    )
  }

  return json(
    {
      success: true,
      status: approval.pairing_status,
      device: {
        name: approval.device_name,
        platform: approval.device_platform,
      },
      expiresAt: approval.pairing_expires_at,
    },
    200,
    rateLimitHeaders(rate)
  )
}
