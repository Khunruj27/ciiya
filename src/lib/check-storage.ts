import { createServerSupabaseClient } from '@/lib/supabase-server'

const FREE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024

export async function checkStorageLimit(userId: string) {
  const supabase = await createServerSupabaseClient()

  type StorageRow = {
  file_size_bytes?: number | null
}

  const { data: storageRows = [], error } = await supabase
    .from('photos')
    .select('file_size_bytes')
    .eq('owner_id', userId)

  if (error) {
    throw new Error(error.message)
  }

  const storageRowsTyped = storageRows as StorageRow[]

const usedBytes = storageRowsTyped.reduce(
  (sum, row) => sum + Number(row.file_size_bytes ?? 0),
  0
)

  const { data: currentSubscription } = await supabase
    .from('subscriptions')
    .select(`
      plan:plans(storage_limit_bytes)
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  const plan = Array.isArray(currentSubscription?.plan)
    ? currentSubscription?.plan[0]
    : currentSubscription?.plan

  const limitBytes = Number(plan?.storage_limit_bytes || FREE_LIMIT_BYTES)

  return {
    usedBytes,
    limitBytes,
    isExceeded: usedBytes >= limitBytes,
  }
}