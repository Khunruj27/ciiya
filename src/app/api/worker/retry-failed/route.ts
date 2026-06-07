import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient()

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

    const { data, error } = await supabase
      .from('photo_jobs')
      .update({
        status: 'pending',
        progress: 0,
        error: null,
        worker_id: null,
        started_at: null,
        finished_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'failed')
      .select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      retried: data?.length ?? 0,
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