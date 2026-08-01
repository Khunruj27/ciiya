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

async function countStatus(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'photo_jobs' | 'face_jobs',
  status: string
) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('status', status)

  if (error) throw new Error(error.message)

  return count || 0
}

export async function GET() {
  try {
    const isAdmin = await requireAdmin()

    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()

    const [
      workers,
      photoPending,
      photoProcessing,
      photoFailed,
      facePending,
      faceProcessing,
      faceFailed,
      recentErrors,
    ] = await Promise.all([
      supabase
        .from('worker_heartbeats')
        .select('*')
        .order('last_seen_at', { ascending: false }),

      countStatus(supabase, 'photo_jobs', 'pending'),
      countStatus(supabase, 'photo_jobs', 'processing'),
      countStatus(supabase, 'photo_jobs', 'failed'),

      countStatus(supabase, 'face_jobs', 'pending'),
      countStatus(supabase, 'face_jobs', 'processing'),
      countStatus(supabase, 'face_jobs', 'failed'),

      supabase
        .from('worker_logs')
        .select('id, worker_type, level, message, created_at')
        .eq('level', 'error')
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    return NextResponse.json({
      success: true,
      checkedAt: new Date().toISOString(),
      workers: workers.data || [],
      queues: {
        photo: {
          pending: photoPending,
          processing: photoProcessing,
          failed: photoFailed,
        },
        face: {
          pending: facePending,
          processing: faceProcessing,
          failed: faceFailed,
        },
      },
      recentErrors: recentErrors.data || [],
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Worker metrics failed',
      },
      { status: 500 }
    )
  }
}