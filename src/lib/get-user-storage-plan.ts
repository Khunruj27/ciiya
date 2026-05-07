import { createServerSupabaseClient } from '@/lib/supabase-server'

export const DEFAULT_FREE_STORAGE_BYTES = 5 * 1024 * 1024 * 1024

export async function getUserStoragePlan(userId: string) {
  const supabase = await createServerSupabaseClient()

  const { data: currentSubscription } = await supabase
    .from('subscriptions')
    .select(`
      id,
      status,
      plan:plans(
        id,
        name,
        storage_limit_bytes
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const subscribedPlan = Array.isArray(currentSubscription?.plan)
    ? currentSubscription.plan[0]
    : currentSubscription?.plan

  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select(`
      original_size_bytes,
      preview_size_bytes,
      thumbnail_size_bytes,
      file_size_bytes
    `)
    .eq('owner_id', userId)

  if (photosError) {
    throw new Error(photosError.message)
  }

  const usedBytes = (photos ?? []).reduce((sum, photo) => {
    const separatedTotal =
      Number(photo.original_size_bytes || 0) +
      Number(photo.preview_size_bytes || 0) +
      Number(photo.thumbnail_size_bytes || 0)

    return sum + (separatedTotal || Number(photo.file_size_bytes || 0))
  }, 0)

  if (subscribedPlan?.storage_limit_bytes) {
    return {
      planName: subscribedPlan.name || 'Current Plan',
      storageLimitBytes: Number(subscribedPlan.storage_limit_bytes),
      usedBytes,
      remainingBytes: Math.max(
        Number(subscribedPlan.storage_limit_bytes) - usedBytes,
        0
      ),
    }
  }

  const { data: freePlan } = await supabase
    .from('plans')
    .select('name, storage_limit_bytes')
    .ilike('name', 'Free%')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  const storageLimitBytes = Number(
    freePlan?.storage_limit_bytes || DEFAULT_FREE_STORAGE_BYTES
  )

  return {
    planName: freePlan?.name || 'Free 5GB',
    storageLimitBytes,
    usedBytes,
    remainingBytes: Math.max(storageLimitBytes - usedBytes, 0),
  }
}