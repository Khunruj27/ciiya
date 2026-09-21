import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { runStorageOrphanCleanup } from '@/lib/storage/consistency'
import { getR2Config } from '@/lib/storage/config'
import type { StorageProvider } from '@/lib/storage/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_MAX_DELETE_PER_RUN = 100

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function authorize(req: NextRequest) {
  const workerSecret = req.headers.get('x-worker-secret')
  const adminSecret = req.headers.get('x-admin-secret')
  if (
    process.env.ADMIN_API_SECRET &&
    adminSecret &&
    adminSecret === process.env.ADMIN_API_SECRET
  ) {
    return { ok: true as const, actor: 'admin-api' }
  }
  if (
    process.env.WORKER_SECRET &&
    workerSecret &&
    workerSecret === process.env.WORKER_SECRET
  ) {
    return { ok: true as const, actor: 'worker' }
  }

  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  const email = data.user?.email?.toLowerCase()
  if (!email) return { ok: false as const, status: 401, error: 'Unauthorized' }
  if (
    process.env.NODE_ENV !== 'development' &&
    !getAdminEmails().includes(email)
  ) {
    return { ok: false as const, status: 403, error: 'Forbidden' }
  }
  return { ok: true as const, actor: email }
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function boundedNumber(value: unknown, fallback: number, maximum: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(Math.floor(parsed), maximum)
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorize(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await req.json().catch(() => ({}))
    const provider: StorageProvider = body.provider === 'r2' ? 'r2' : 'supabase'
    const dryRun = body.dryRun !== false
    const prefix = String(body.prefix || '').trim()
    const limit = boundedNumber(
      body.limit,
      DEFAULT_MAX_DELETE_PER_RUN,
      DEFAULT_MAX_DELETE_PER_RUN
    )
    const scanLimit = boundedNumber(body.scanLimit, 10_000, 100_000)
    const bucket =
      provider === 'r2'
        ? getR2Config().bucketName
        : String(body.bucket || 'albums').trim()
    const allowR2Delete =
      process.env.STORAGE_CLEANUP_ALLOW_R2_DELETE === 'true'
    const supabase = getAdminClient()
    const result = await runStorageOrphanCleanup({
      supabase,
      provider,
      bucket,
      prefix,
      dryRun,
      maxDelete: limit,
      scanLimit,
      allowR2Delete,
    })

    await supabase.from('worker_logs').insert({
      worker_type: 'storage-cleanup',
      level: result.failedCount > 0 ? 'warning' : 'info',
      message: result.dryRun
        ? 'Provider-aware storage cleanup dry run completed'
        : 'Provider-aware storage cleanup completed',
      metadata: { actor: auth.actor, ...result },
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Cleanup orphan failed',
      },
      { status: 500 }
    )
  }
}
