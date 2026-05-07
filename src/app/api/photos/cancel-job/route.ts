import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabase =
      await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await req.json()

    const photoId = String(
      body.photoId || ''
    ).trim()

    if (!photoId) {
      return NextResponse.json(
        { error: 'Missing photoId' },
        { status: 400 }
      )
    }

    const { data: job } = await supabase
      .from('photo_jobs')
      .select(`
        id,
        owner_id,
        status
      `)
      .eq('photo_id', photoId)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    if (job.status === 'done') {
      return NextResponse.json(
        { error: 'Job already completed' },
        { status: 400 }
      )
    }

    await supabase
      .from('photo_jobs')
      .update({
        status: 'cancelled',
        cancelled_at:
          new Date().toISOString(),
      })
      .eq('id', job.id)

    await supabase
      .from('photos')
      .update({
        processing_status:
          'cancelled',
      })
      .eq('id', photoId)

    return NextResponse.json({
      success: true,
      cancelled: true,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Cancel failed',
      },
      { status: 500 }
    )
  }
}