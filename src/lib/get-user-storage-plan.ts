import { createServerSupabaseClient } from '@/lib/supabase-server'
import { PLAN_LIMITS, type PlanKey } from '@/lib/plans'

function normalizePlanKey(value?: string | null): PlanKey {
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

function parseStorageBytes(
  value: unknown,
  fieldName: string,
  fallback: number
) {
  const resolvedValue = value ?? fallback
  const parsedValue = Number(resolvedValue)

  if (
    !Number.isSafeInteger(parsedValue) ||
    parsedValue < 0
  ) {
    throw new Error(`Invalid ${fieldName}`)
  }

  return parsedValue
}

export async function getUserStoragePlan(userId: string) {
  const normalizedUserId = userId.trim()

  if (!normalizedUserId) {
    throw new Error('Invalid userId')
  }

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('user_storage_usage')
    .select(
      'current_plan, storage_limit_bytes, storage_used_bytes, used_bytes'
    )
    .eq('user_id', normalizedUserId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load user storage plan: ${error.message}`)
  }

  const plan = normalizePlanKey(data?.current_plan || 'free')
  const defaultStorageLimit = PLAN_LIMITS[plan].storageBytes

  const usedBytes = parseStorageBytes(
    data?.storage_used_bytes ?? data?.used_bytes,
    'storage usage',
    0
  )

  const storageLimitBytes = parseStorageBytes(
    data?.storage_limit_bytes,
    'storage limit',
    defaultStorageLimit
  )

  return {
    plan,
    planName: PLAN_LIMITS[plan].name,
    usedBytes,
    limitBytes: storageLimitBytes,
    storageLimitBytes,
    remainingBytes: Math.max(storageLimitBytes - usedBytes, 0),
  }
}