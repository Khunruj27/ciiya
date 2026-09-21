import type { StorageProvider } from './types'

export type PhotoDownloadStoragePlan = {
  provider: StorageProvider
  buckets: string[]
}

export function normalizePhotoStorageProvider(
  value: unknown
): StorageProvider {
  if (value == null || value === '') return 'supabase'
  if (value === 'supabase' || value === 'r2') return value

  throw new Error(`Unsupported photo storage provider: ${String(value)}`)
}

/**
 * Resolves storage buckets for one already-authorized photo object.
 *
 * Legacy Supabase originals may be in either the private `originals` bucket
 * or the public `albums` bucket while the migration is in progress. R2 rows
 * always carry their exact bucket and never fall back across buckets.
 */
export function buildPhotoDownloadStoragePlan(params: {
  storageProvider: unknown
  storageBucket?: string | null
  path: string
}): PhotoDownloadStoragePlan {
  const provider = normalizePhotoStorageProvider(params.storageProvider)

  if (provider === 'r2') {
    const bucket = params.storageBucket?.trim()

    if (!bucket) {
      throw new Error('R2 photo is missing storage_bucket')
    }

    return {
      provider,
      buckets: [bucket],
    }
  }

  return {
    provider,
    buckets: params.path.includes('/original/')
      ? ['originals', 'albums']
      : ['albums'],
  }
}
