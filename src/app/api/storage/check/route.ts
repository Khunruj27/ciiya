import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const uploadSizeBytes = Number(body.uploadSizeBytes || 0)

    if (!uploadSizeBytes || uploadSizeBytes <= 0) {
      return NextResponse.json(
        { error: 'uploadSizeBytes is required' },
        { status: 400 }
      )
    }

    const { data: storageRows = [], error: storageError } = await supabase
      .from('photos')
      .select('file_size_bytes')
      .eq('owner_id', user.id)

    if (storageError) {
      return NextResponse.json({ error: storageError.message }, { status: 500 })
    }

    const usedBytes = storageRows.reduce(
      (sum, row) => sum + Number(row.file_size_bytes || 0),
      0
    )

    const { data: currentSubscription } = await supabase
      .from('subscriptions')
      .select(`
        id,
        status,
        plan:plans(storage_limit_bytes)
      `)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const limitBytes =
      currentSubscription?.plan?.storage_limit_bytes ||
      5 * 1024 * 1024 * 1024

    const willUseBytes = usedBytes + uploadSizeBytes
    const remainingBytes = Math.max(limitBytes - usedBytes, 0)

    if (willUseBytes > limitBytes) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Storage full. Please upgrade your plan.',
          usedBytes,
          limitBytes,
          remainingBytes,
          uploadSizeBytes,
          willUseBytes,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      usedBytes,
      limitBytes,
      remainingBytes,
      uploadSizeBytes,
      willUseBytes,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Storage check failed',
      },
      { status: 500 }
    )
  }
}