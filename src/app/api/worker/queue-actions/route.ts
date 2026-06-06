import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type QueueAction =
  | 'reset_stuck_photo_jobs'
  | 'reset_stuck_face_jobs'
  | 'retry_failed_photo_jobs'
  | 'retry_failed_face_jobs'

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
    }
  }

  const adminEmails = getAdminEmails()
  const isAdmin = adminEmails.includes(user.email.toLowerCase())

  if (!isAdmin) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden',
    }
  }

  return {
    ok: true,
    status: 200,
    error: null,
  }
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

function isQueueAction(value: string): value is QueueAction {
  return [
    'reset_stuck_photo_jobs',
    'reset_stuck_face_jobs',
    'retry_failed_photo_jobs',
    'retry_failed_face_jobs',
  ].includes(value)
}

async function logAdminAction(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  action: QueueAction
  count: number
  userEmail?: string | null
}) {
  const { supabase, action, count, userEmail } = params

  await supabase.from('worker_logs').insert({
    worker_type: 'admin',
    level: 'info',
    message: `Admin queue action: ${action}`,
    metadata: {
      action,
      count,
      userEmail,
    },
    meta: {
      action,
      count,
      userEmail,
    },
  })
}

async function resetStuckJobs(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  table: 'photo_jobs' | 'face_jobs'
  staleMinutes: number
  message: string
}) {
  const staleSince = new Date(
    Date.now() - params.staleMinutes * 60 * 1000
  ).toISOString()

  const { data, error } = await params.supabase
    .from(params.table)
    .update({
      status: 'pending',
      progress: 0,
      started_at: null,
      finished_at: null,
      error: params.message,
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'processing')
    .lt('started_at', staleSince)
    .select('id')

  if (error) throw new Error(error.message)

  return data?.length || 0
}

async function retryFailedJobs(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
  table: 'photo_jobs' | 'face_jobs'
  photoStatusPayload: Record<string, unknown>
  limit?: number
  message: string
}) {
  const { data: jobs, error: selectError } = await params.supabase
    .from(params.table)
    .select('id, photo_id, retry_count, retries')
    .eq('status', 'failed')
    .lt('retry_count', 3)
    .order('updated_at', { ascending: true })
    .limit(params.limit || 100)

  if (selectError) throw new Error(selectError.message)

  const ids = (jobs || []).map((job) => job.id)
  const photoIds = (jobs || [])
    .map((job) => job.photo_id)
    .filter(Boolean)

  if (ids.length === 0) return 0

  const { error: updateError } = await params.supabase
    .from(params.table)
    .update({
      status: 'pending',
      progress: 0,
      started_at: null,
      finished_at: null,
      error: params.message,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (updateError) throw new Error(updateError.message)

  if (photoIds.length > 0) {
    await params.supabase
      .from('photos')
      .update({
        ...params.photoStatusPayload,
        updated_at: new Date().toISOString(),
      })
      .in('id', photoIds)
  }

  return ids.length
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()

    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.error },
        { status: admin.status }
      )
    }

    const body = await req.json().catch(() => null)
    const action = String(body?.action || '')

    if (!isQueueAction(action)) {
      return NextResponse.json(
        { error: 'Invalid queue action' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()
    let count = 0

    if (action === 'reset_stuck_photo_jobs') {
      count = await resetStuckJobs({
        supabase,
        table: 'photo_jobs',
        staleMinutes: 10,
        message: 'Reset stuck photo job from admin queue',
      })
    }

    if (action === 'reset_stuck_face_jobs') {
      count = await resetStuckJobs({
        supabase,
        table: 'face_jobs',
        staleMinutes: 15,
        message: 'Reset stuck face job from admin queue',
      })
    }

    if (action === 'retry_failed_photo_jobs') {
      count = await retryFailedJobs({
        supabase,
        table: 'photo_jobs',
        message: 'Retried failed photo job from admin queue',
        photoStatusPayload: {
          processing_status: 'pending',
          processing_progress: 0,
        },
        limit: 100,
      })
    }

    if (action === 'retry_failed_face_jobs') {
      count = await retryFailedJobs({
        supabase,
        table: 'face_jobs',
        message: 'Retried failed face job from admin queue',
        photoStatusPayload: {
          face_scan_status: 'pending',
          face_scan_progress: 0,
          face_scan_error: null,
        },
        limit: 100,
      })
    }

    await logAdminAction({
      supabase,
      action,
      count,
      userEmail: null,
    })

    return NextResponse.json({
      success: true,
      action,
      count,
    })
  } catch (error) {
    console.error('[queue-actions] fatal:', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Queue action failed',
      },
      { status: 500 }
    )
  }
}