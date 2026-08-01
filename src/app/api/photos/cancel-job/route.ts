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

const body = await req.json().catch(() => null)

if (
  !body ||
  typeof body !== 'object' ||
  Array.isArray(body)
) {
  return NextResponse.json(
    { error: 'Invalid request body' },
    { status: 400 }
  )
}

const photoId = String(
  body.photoId || ''
).trim()

if (!photoId) {
  return NextResponse.json(
    { error: 'Missing photoId' },
    { status: 400 }
  )
}

if (photoId.length > 100) {
  return NextResponse.json(
    { error: 'Invalid photoId' },
    { status: 400 }
  )
}

const { data: job, error: jobError } =
  await supabase
    .from('photo_jobs')
    .select(`
      id,
      owner_id,
      status
    `)
    .eq('photo_id', photoId)
    .eq('owner_id', user.id)
    .maybeSingle()

if (jobError) {
  console.error(
    '[photos/cancel-job] job lookup failed:',
    jobError.message
  )

  return NextResponse.json(
    { error: 'Cancel failed' },
    { status: 500 }
  )
}

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

const cancelledAt = new Date().toISOString()

const {
  data: cancelledJob,
  error: cancelJobError,
} = await supabase
  .from('photo_jobs')
  .update({
    status: 'cancelled',
    cancelled_at: cancelledAt,
  })
  .eq('id', job.id)
  .eq('owner_id', user.id)
  .neq('status', 'done')
  .select('id')
  .maybeSingle()

if (cancelJobError) {
  console.error(
    '[photos/cancel-job] job update failed:',
    cancelJobError.message
  )

  return NextResponse.json(
    { error: 'Cancel failed' },
    { status: 500 }
  )
}

if (!cancelledJob) {
  return NextResponse.json(
    { error: 'Job already completed' },
    { status: 400 }
  )
}

const {
  data: cancelledPhoto,
  error: cancelPhotoError,
} = await supabase
  .from('photos')
  .update({
    processing_status: 'cancelled',
    updated_at: cancelledAt,
  })
  .eq('id', photoId)
  .eq('owner_id', user.id)
  .select('id')
  .maybeSingle()

if (cancelPhotoError) {
  console.error(
    '[photos/cancel-job] photo update failed:',
    cancelPhotoError.message
  )

  return NextResponse.json(
    { error: 'Cancel failed' },
    { status: 500 }
  )
}

if (!cancelledPhoto) {
  console.error(
    '[photos/cancel-job] owned photo not found after job cancellation:',
    photoId
  )

  return NextResponse.json(
    { error: 'Cancel failed' },
    { status: 500 }
  )
}

    return NextResponse.json({
      success: true,
      cancelled: true,
    })
} catch (error) {
  console.error(
    '[photos/cancel-job] unexpected error:',
    error
  )

  return NextResponse.json(
    { error: 'Cancel failed' },
    { status: 500 }
  )
}
}