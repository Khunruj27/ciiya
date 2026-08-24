import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase admin env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient()
    const supabaseAdmin = getSupabaseAdmin()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminEmails = getAdminEmails()
    const userEmail = user.email.toLowerCase()

    const isAdmin =
      process.env.NODE_ENV === 'development' ||
      adminEmails.includes(userEmail)

    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: jobs, error: selectError } = await supabaseAdmin
  .from('photo_jobs')
  .select('id, photo_id')
  .eq('status', 'failed')
  .order('updated_at', { ascending: true })
  .limit(100)

if (selectError) {
  return NextResponse.json({ error: selectError.message }, { status: 500 })
}

const jobIds = (jobs || []).map((job) => job.id)
const photoIds = (jobs || [])
  .map((job) => job.photo_id)
  .filter(Boolean)

if (jobIds.length === 0) {
  return NextResponse.json({
    success: true,
    retried: 0,
  })
}

const { error } = await supabaseAdmin
  .from('photo_jobs')
  .update({
    status: 'pending',
    progress: 0,
    retry_count: 0,
    retries: 0,
    error: null,
    worker_id: null,
    claimed_by: null,
    started_at: null,
    finished_at: null,
    updated_at: new Date().toISOString(),
  })
  .in('id', jobIds)

if (error) {
  return NextResponse.json({ error: error.message }, { status: 500 })
}

if (photoIds.length > 0) {
  await supabaseAdmin
    .from('photos')
    .update({
  processing_status: 'pending',
  processing_progress: 0,
  processing_error: null,
  updated_at: new Date().toISOString(),
})
    .in('id', photoIds)
}

const { error: logError } = await supabaseAdmin
  .from('worker_logs')
  .insert({
    worker_type: 'admin',
    level: 'info',
    message: 'Retry failed photo jobs',
    metadata: {
      userEmail,
      retried: jobIds.length,
    },
    meta: {
      userEmail,
      retried: jobIds.length,
    },
  })

if (logError) {
  console.error('[retry-failed] log failed:', logError.message)
}

    return NextResponse.json({
  success: true,
  retried: jobIds.length,
})
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Retry failed jobs failed',
      },
      { status: 500 }
    )
  }
}