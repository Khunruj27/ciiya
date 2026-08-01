import { getUserStoragePlan } from '@/lib/get-user-storage-plan'

export async function checkStorageLimit(
  userId: string,
  additionalBytes = 0
) {
  const normalizedUserId = userId.trim()

  if (!normalizedUserId) {
    throw new Error('Invalid userId')
  }

  if (
    !Number.isSafeInteger(additionalBytes) ||
    additionalBytes < 0
  ) {
    throw new Error('Invalid additionalBytes')
  }

  const { usedBytes, limitBytes, remainingBytes } =
    await getUserStoragePlan(normalizedUserId)

  if (
    !Number.isSafeInteger(usedBytes) ||
    usedBytes < 0 ||
    !Number.isSafeInteger(limitBytes) ||
    limitBytes < 0
  ) {
    throw new Error('Invalid storage usage data')
  }

  const nextUsedBytes = usedBytes + additionalBytes

  if (!Number.isSafeInteger(nextUsedBytes)) {
    throw new Error('Storage usage exceeds safe integer range')
  }

  return {
    usedBytes,
    limitBytes,
    remainingBytes,
    additionalBytes,
    nextUsedBytes,
    isExceeded: nextUsedBytes > limitBytes,
  }
}