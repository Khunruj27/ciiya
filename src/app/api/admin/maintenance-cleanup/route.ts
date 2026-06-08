import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_DRY_RUN = true
const MAX_DELETE_PER_RUN = 500

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function isAuthorized(req: NextRequest) {
  const workerSecret = req.headers.get('x-worker-secret')

  if (
    process.env.WORKER_SECRET &&
    workerSecret &&
    workerSecret === process.env.WORKER_SECRET
  ) {
    return true
  }

  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) return false

  return (
    process.env.NODE_ENV === 'development' ||
    getAdminEmails().includes(user.email.toLowerCase())
  )
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

async function cleanupWorkerLogs(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  dryRun: boolean
  keepDays: number
  limit: number
}) {
  const cutoff = new Date(
    Date.now() - params.keepDays * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data, error } = await params.supabase
    .from('worker_logs')
    .select('id')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(params.limit)

  if (error) throw new Error(error.message)

  const ids = (data || []).map((item) => item.id)

  if (!params.dryRun && ids.length > 0) {
    const { error: deleteError } = await params.supabase
      .from('worker_logs')
      .delete()
      .in('id', ids)

    if (deleteError) throw new Error(deleteError.message)
  }

  return {
    cutoff,
    matched: ids.length,
    deleted: params.dryRun ? 0 : ids.length,
  }
}

async function cleanupWorkerHeartbeats(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  dryRun: boolean
  keepHours: number
  limit: number
}) {
  const cutoff = new Date(
    Date.now() - params.keepHours * 60 * 60 * 1000
  ).toISOString()

  const { data, error } = await params.supabase
    .from('worker_heartbeats')
    .select('worker_id')
    .lt('last_seen_at', cutoff)
    .order('last_seen_at', { ascending: true })
    .limit(params.limit)

  if (error) throw new Error(error.message)

  const ids = (data || []).map((item) => item.worker_id)

  if (!params.dryRun && ids.length > 0) {
    const { error: deleteError } = await params.supabase
      .from('worker_heartbeats')
      .delete()
      .in('worker_id', ids)

    if (deleteError) throw new Error(deleteError.message)
  }

  return {
    cutoff,
    matched: ids.length,
    deleted: params.dryRun ? 0 : ids.length,
  }
}

export async function POST(req: NextRequest) {
  try {
    const authorized = await isAuthorized(req)

    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))

    const dryRun =
      typeof body.dryRun === 'boolean' ? body.dryRun : DEFAULT_DRY_RUN

    const keepLogDays = Math.max(1, Number(body.keepLogDays || 14))
    const keepHeartbeatHours = Math.max(
      1,
      Number(body.keepHeartbeatHours || 24)
    )

    const limit = Math.min(
      MAX_DELETE_PER_RUN,
      Math.max(1, Number(body.limit || 100))
    )

    const supabase = getSupabaseAdmin()

    const [workerLogs, workerHeartbeats] = await Promise.all([
      cleanupWorkerLogs({
        supabase,
        dryRun,
        keepDays: keepLogDays,
        limit,
      }),
      cleanupWorkerHeartbeats({
        supabase,
        dryRun,
        keepHours: keepHeartbeatHours,
        limit,
      }),
    ])

    await supabase.from('worker_logs').insert({
      worker_type: 'maintenance',
      level: 'info',
      message: dryRun
        ? 'Maintenance cleanup dry run completed'
        : 'Maintenance cleanup completed',
      metadata: {
        dryRun,
        keepLogDays,
        keepHeartbeatHours,
        limit,
        workerLogs,
        workerHeartbeats,
      },
    })

    return NextResponse.json({
      success: true,
      dryRun,
      keepLogDays,
      keepHeartbeatHours,
      limit,
      workerLogs,
      workerHeartbeats,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Maintenance cleanup failed',
      },
      { status: 500 }
    )
  }
}