import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getR2Config,
  isR2PhotoUploadEnabledForOwner,
  isR2PublicAssetUploadEnabledForOwner,
} from './config'
import { createStorageRef } from './paths'
import type { StorageObjectRef, StorageProvider } from './types'

export type StorageAssetKind = 'portfolio' | 'guest_moment' | 'preset'

export type StorageAssetRecord = {
  id: string
  owner_id: string
  album_id: string | null
  asset_kind: StorageAssetKind
  storage_provider: StorageProvider
  storage_bucket: string
  object_key: string
  public_url: string | null
  original_name: string | null
  content_type: string
  size_bytes: number
  status: 'uploading' | 'active' | 'failed' | 'deleting'
  expires_at?: string | null
  created_at?: string
}

export type PortfolioStorageAsset = {
  id: string
  provider: StorageProvider
  bucket: string
  key: string
  url: string
  sizeBytes: number
}

function normalizeProvider(value: unknown): StorageProvider | null {
  if (value === 'supabase' || value === 'r2') return value
  return null
}

export function getStorageAssetTarget(kind: StorageAssetKind, ownerId: string): {
  provider: StorageProvider
  bucket: string
} {
  const publicAsset = kind === 'portfolio' || kind === 'guest_moment'
  const useR2 = publicAsset
    ? isR2PublicAssetUploadEnabledForOwner(ownerId)
    : isR2PhotoUploadEnabledForOwner(ownerId)

  if (useR2) {
    return {
      provider: 'r2',
      bucket: getR2Config().bucketName,
    }
  }

  return {
    provider: 'supabase',
    bucket:
      kind === 'portfolio'
        ? 'albums'
        : kind === 'guest_moment'
          ? 'guest-moments'
          : 'presets',
  }
}

export function toPortfolioStorageAsset(
  asset: StorageAssetRecord
): PortfolioStorageAsset | null {
  const provider = normalizeProvider(asset.storage_provider)
  const url = asset.public_url?.trim()
  const sizeBytes = Number(asset.size_bytes)

  if (
    !provider ||
    !url ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1
  ) {
    return null
  }

  return {
    id: asset.id,
    provider,
    bucket: asset.storage_bucket,
    key: asset.object_key,
    url,
    sizeBytes,
  }
}

export async function resolvePresetStorageRef(params: {
  supabase: SupabaseClient
  ownerId: string
  presetPath: string
  albumId?: string | null
}): Promise<StorageObjectRef | null> {
  const { data, error } = await params.supabase
    .from('storage_assets')
    .select('storage_provider, storage_bucket, object_key')
    .eq('owner_id', params.ownerId)
    .eq('asset_kind', 'preset')
    .eq('object_key', params.presetPath)
    .eq('status', 'active')
    .maybeSingle()

  if (!error && data) {
    const provider = normalizeProvider(data.storage_provider)

    if (!provider) return null

    return createStorageRef({
      provider,
      bucket: String(data.storage_bucket || ''),
      key: String(data.object_key || ''),
    })
  }

  // Presets created before Phase 10 are not present in storage_assets. Their
  // path format identifies the legacy private Supabase bucket.
  const userPrefix = `${params.ownerId}/presets/`
  const albumPrefix = params.albumId
    ? `${params.ownerId}/${params.albumId}/presets/`
    : null

  if (params.presetPath.startsWith(userPrefix)) {
    return createStorageRef({
      provider: 'supabase',
      bucket: 'presets',
      key: params.presetPath,
    })
  }

  if (albumPrefix && params.presetPath.startsWith(albumPrefix)) {
    return createStorageRef({
      provider: 'supabase',
      bucket: 'albums',
      key: params.presetPath,
    })
  }

  return null
}
