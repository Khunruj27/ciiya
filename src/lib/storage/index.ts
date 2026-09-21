import { getDefaultStorageProvider } from './config'
import { createR2StorageAdapter } from './r2'
import { createSupabaseStorageAdapter } from './supabase'
import type {
  StorageAdapter,
  StorageAdapterDependencies,
  StorageProvider,
} from './types'

export * from './config'
export * from './assets'
export * from './album-covers'
export * from './delivery'
export * from './migration'
export * from './paths'
export * from './production-validation'
export * from './source-cleanup'
export * from './types'
export { createR2StorageAdapter } from './r2'
export { createSupabaseStorageAdapter } from './supabase'

export function getStorageAdapter(
  provider: StorageProvider = getDefaultStorageProvider(),
  dependencies: StorageAdapterDependencies = {}
): StorageAdapter {
  if (typeof window !== 'undefined') {
    throw new Error('Storage adapters are server-only')
  }

  if (provider === 'r2') {
    return createR2StorageAdapter(undefined, dependencies.r2Client)
  }

  return createSupabaseStorageAdapter(dependencies.supabase)
}
