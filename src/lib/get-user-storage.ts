import { getUserStoragePlan } from '@/lib/get-user-storage-plan'

export async function getUserStorage(userId: string) {
  const { usedBytes } = await getUserStoragePlan(userId)

  return usedBytes
}