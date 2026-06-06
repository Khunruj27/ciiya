import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function requireAdmin() {
  if (process.env.NODE_ENV === 'development') {
    return {
      ok: true,
      status: 200,
      error: null,
    }
  }

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

async function countByStatus(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'photo_jobs' | 'face_jobs'
) {
  const statuses = ['pending', 'processing', 'done', 'failed']

  const results = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await supabase
        .from(table)
        .select('id', {
          count: 'exact',
          head: true,
        })
        .eq('status', status)

      if (error) {
        console.error(`[queue-stats] ${table}.${status}:`, error.message)

        return {
          status,
          count: 0,
        }
      }

      return {
        status,
        count: count || 0,
      }
    })
  )

  return results.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = item.count
    return acc
  }, {})
}

async function getWorkers(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data, error } = await supabase
    .from('worker_heartbeats')
    .select(
      `
      worker_id,
      worker_name,
      worker_type,
      status,
      last_seen,
      last_seen_at,
      metadata
      `
    )
    .order('last_seen_at', { ascending: false })

  if (error) {
    console.error('[queue-stats] workers:', error.message)
    return []
  }

  return data || []
}

async function getRecentErrors(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data, error } = await supabase
    .from('worker_logs')
    .select(
      `
      id,
      worker_type,
      level,
      message,
      photo_id,
      album_id,
      created_at
      `
    )
    .eq('level', 'error')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[queue-stats] recent errors:', error.message)
    return []
  }

  return data || []
}

async function getFailedJobs(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'photo_jobs' | 'face_jobs'
) {
  const { data, error } = await supabase
    .from(table)
    .select(
      `
      id,
      photo_id,
      album_id,
      status,
      retry_count,
      error,
      created_at,
      started_at,
      finished_at
      `
    )
    .eq('status', 'failed')
    .order('finished_at', {
      ascending: false,
      nullsFirst: false,
    })
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error(`[queue-stats] failed ${table}:`, error.message)
    return []
  }

  return data || []
}

export async function GET() {
  try {
    const admin = await requireAdmin()

    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.error },
        { status: admin.status }
      )
    }

    const supabase = getSupabaseAdmin()

    const [
      photoJobs,
      faceJobs,
      workers,
      recentErrors,
      failedPhotoJobs,
      failedFaceJobs,
    ] = await Promise.all([
      countByStatus(supabase, 'photo_jobs'),
      countByStatus(supabase, 'face_jobs'),
      getWorkers(supabase),
      getRecentErrors(supabase),
      getFailedJobs(supabase, 'photo_jobs'),
      getFailedJobs(supabase, 'face_jobs'),
    ])

    return NextResponse.json({
      success: true,
      photoJobs,
      faceJobs,
      workers,
      recentErrors,
      failedPhotoJobs,
      failedFaceJobs,
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[queue-stats] fatal:', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Queue stats failed',
      },
      { status: 500 }
    )
  }
}