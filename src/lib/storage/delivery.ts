import { getR2PublicBaseUrl } from './config'
import {
  encodeObjectKey,
  isPublicDeliveryKey,
  normalizeObjectKey,
} from './paths'
import { normalizePhotoStorageProvider } from './photo-download-plan'
import type { StorageProvider } from './types'

export type PhotoDeliveryRecord = {
  storage_provider?: unknown
  storage_bucket?: string | null
  public_url?: string | null
  image_url?: string | null
  original_url?: string | null
  preview_url?: string | null
  thumbnail_url?: string | null
  sd_url?: string | null
  hd_url?: string | null
  uhd_url?: string | null
  storage_path?: string | null
  original_path?: string | null
  preview_path?: string | null
  thumbnail_path?: string | null
  sd_path?: string | null
  hd_path?: string | null
  uhd_path?: string | null
}

function cleanUrl(value: unknown) {
  if (typeof value !== 'string') return null
  const url = value.trim()
  return /^https?:\/\//i.test(url) || url.startsWith('data:') ? url : null
}

function supabasePublicBaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!value) return null
  try {
    return new URL(value).toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function resolvePublicStorageUrl(params: {
  provider: StorageProvider
  bucket?: string | null
  key?: string | null
}) {
  const rawKey = params.key?.trim()
  if (!rawKey) return null

  let key: string
  try {
    key = normalizeObjectKey(rawKey)
  } catch {
    return null
  }
  if (!isPublicDeliveryKey(key)) return null

  if (params.provider === 'r2') {
    let baseUrl: string | null = null
    try {
      baseUrl = getR2PublicBaseUrl()
    } catch {
      return null
    }
    return baseUrl ? `${baseUrl}/${encodeObjectKey(key)}` : null
  }

  const baseUrl = supabasePublicBaseUrl()
  const bucket = params.bucket?.trim() || 'albums'
  if (!baseUrl || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)) return null
  return `${baseUrl}/storage/v1/object/public/${bucket}/${encodeObjectKey(key)}`
}

/**
 * Rehydrates public preview URLs from provider metadata. R2-derived URLs win
 * over stored Supabase URLs after a row switches provider; legacy Supabase
 * rows prefer their stored URL and only synthesize missing derivatives.
 * Originals and generated download tiers are deliberately never exposed.
 */
export function resolvePhotoDelivery<T extends PhotoDeliveryRecord>(photo: T) {
  let provider: StorageProvider
  try {
    provider = normalizePhotoStorageProvider(photo.storage_provider)
  } catch {
    provider = 'supabase'
  }
  const bucket =
    provider === 'r2' ? photo.storage_bucket?.trim() || null : 'albums'
  const resolvedPreview = resolvePublicStorageUrl({
    provider,
    bucket,
    key: photo.preview_path,
  })
  const resolvedThumbnail = resolvePublicStorageUrl({
    provider,
    bucket,
    key: photo.thumbnail_path,
  })
  const storedPreview = cleanUrl(photo.preview_url)
  const storedThumbnail = cleanUrl(photo.thumbnail_url)
  const storedPublic = cleanUrl(photo.public_url)
  const storedImage = cleanUrl(photo.image_url)
  const previewUrl =
    provider === 'r2'
      ? resolvedPreview || storedPreview || storedPublic
      : storedPreview || resolvedPreview || storedPublic
  const thumbnailUrl =
    provider === 'r2'
      ? resolvedThumbnail || storedThumbnail
      : storedThumbnail || resolvedThumbnail
  const publicUrl = previewUrl || thumbnailUrl || storedPublic

  return {
    ...photo,
    preview_url: previewUrl,
    thumbnail_url: thumbnailUrl,
    public_url: publicUrl,
    image_url: previewUrl || thumbnailUrl || storedImage,
    // Never synthesize original/sd/hd/uhd URLs. They are private for R2 and
    // continue through the authorized download endpoint.
    original_url: provider === 'r2' ? null : cleanUrl(photo.original_url),
    sd_url: provider === 'r2' ? null : cleanUrl(photo.sd_url),
    hd_url: provider === 'r2' ? null : cleanUrl(photo.hd_url),
    uhd_url: provider === 'r2' ? null : cleanUrl(photo.uhd_url),
  }
}

export function resolvePhotoDeliveries<T extends PhotoDeliveryRecord>(
  photos: T[]
) {
  return photos.map(resolvePhotoDelivery)
}
