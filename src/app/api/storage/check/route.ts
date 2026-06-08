import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { PLAN_LIMITS } from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type StorageRow = {
  original_size_bytes?: number | null
  preview_size_bytes?: number | null
  thumbnail_size_bytes?: number | null
  file_size_bytes?: number | null
}

function normalizePlanKey(value?: string | null): keyof typeof PLAN_LIMITS {
  const plan = String(value || '').toLowerCase().trim()

  if (plan === 'starter' || plan === '20gb') return 'starter'
  if (plan === 'pro' || plan === 'pro-50gb' || plan === '50gb') return 'pro'
  if (
    plan === 'business' ||
    plan === 'pro-100gb' ||
    plan === '100gb'
  ) {
    return 'business'
  }

  return 'free'
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
      .select(
        `
        used_bytes,
        storage_used_bytes,
        storage_limit_bytes,
        current_plan
        `
      )
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
        return NextResponse.json(
          { error: storageError.message },
          { status: 500 }
        )
      }

      usedBytes = (storageRows as StorageRow[]).reduce((sum, row) => {
        const separatedTotal =
          Number(row.original_size_bytes || 0) +
          Number(row.preview_size_bytes || 0) +
          Number(row.thumbnail_size_bytes || 0)

        return sum + (separatedTotal || Number(row.file_size_bytes || 0))
      }, 0)
    }

    const currentPlan = normalizePlanKey(usage?.current_plan)
    const fallbackLimit = PLAN_LIMITS[currentPlan].storageBytes

    const limitBytes = Number(
      usage?.storage_limit_bytes || fallbackLimit
    )

    const remainingBytes = Math.max(0, limitBytes - usedBytes)
    const percent = limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0

    return NextResponse.json({
      success: true,
      usedBytes,
      limitBytes,
      remainingBytes,
      currentPlan,
      percent,
      isExceeded: limitBytes > 0 ? usedBytes >= limitBytes : false,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}