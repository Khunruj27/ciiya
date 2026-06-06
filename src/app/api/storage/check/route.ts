import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

const FREE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024

type StorageRow = {
  file_size_bytes: number | null
}

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: storageRows = [], error: storageError } = await supabase
      .from('photos')
      .select('file_size_bytes')
      .eq('owner_id', user.id)

    if (storageError) {
      return NextResponse.json({ error: storageError.message }, { status: 500 })
    }

    const usedBytes = (storageRows as StorageRow[]).reduce(
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

    const plan = Array.isArray(currentSubscription?.plan)
      ? currentSubscription.plan[0]
      : currentSubscription?.plan

    const limitBytes = Number(plan?.storage_limit_bytes || FREE_LIMIT_BYTES)

    return NextResponse.json({
      usedBytes,
      limitBytes,
      percent: limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}