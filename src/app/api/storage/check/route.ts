import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

const FREE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024

type StorageRow = {
  original_size_bytes?: number | null
  preview_size_bytes?: number | null
  thumbnail_size_bytes?: number | null
  file_size_bytes?: number | null
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

    const { data: usage } = await supabase
      .from('user_storage_usage')
      .select('used_bytes, storage_used_bytes, storage_limit_bytes, current_plan')
      .eq('user_id', user.id)
      .maybeSingle()

    let usedBytes = Number(
      usage?.storage_used_bytes ?? usage?.used_bytes ?? 0
    )

    if (!usedBytes) {
      const { data: storageRows = [], error: storageError } = await supabase
        .from('photos')
        .select(
          'original_size_bytes, preview_size_bytes, thumbnail_size_bytes, file_size_bytes'
        )
        .eq('owner_id', user.id)

      if (storageError) {
        return NextResponse.json({ error: storageError.message }, { status: 500 })
      }

      usedBytes = (storageRows as StorageRow[]).reduce((sum, row) => {
        const separatedTotal =
          Number(row.original_size_bytes || 0) +
          Number(row.preview_size_bytes || 0) +
          Number(row.thumbnail_size_bytes || 0)

        return sum + (separatedTotal || Number(row.file_size_bytes || 0))
      }, 0)
    }

    const limitBytes = Number(
      usage?.storage_limit_bytes || FREE_LIMIT_BYTES
    )

    return NextResponse.json({
      usedBytes,
      limitBytes,
      currentPlan: usage?.current_plan || 'free',
      percent: limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0,
      isExceeded: limitBytes > 0 ? usedBytes >= limitBytes : false,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}