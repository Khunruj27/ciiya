import { normalizeObjectKey, type PhotoObjectKind } from './paths'
import type { StorageProvider } from './types'

export type PhotoWorkerSelectedSize = 'sd' | 'hd' | 'uhd' | 'original'

export type PhotoWorkerObjectPlan = {
  previewKey: string
  thumbnailKey: string
  selectedDerivativeKey: string | null
  shouldUploadPreview: boolean
  shouldRelocateSupabaseOriginal: boolean
  shouldReplaceSupabaseRawOriginal: boolean
}

function replacePhotoObjectKind(
  originalKey: string,
  kind: PhotoObjectKind
) {
  const key = normalizeObjectKey(originalKey)
  const parts = key.split('/')

  if (parts.length !== 4 || parts[2] !== 'original') {
    throw new Error('Photo Worker requires an original object key')
  }

  const objectName = parts[3].replace(/\.[^/.]+$/, '')

  if (!objectName) {
    throw new Error('Photo Worker object key is missing an object name')
  }

  return `${parts[0]}/${parts[1]}/${kind}/${objectName}.jpg`
}

/**
 * Builds the provider-specific object plan without performing any storage I/O.
 *
 * Supabase preserves the legacy behavior during the dual-provider migration.
 * R2 always separates the public display preview from private originals and
 * private delivery tiers, including albums configured for original download.
 */
export function buildPhotoWorkerObjectPlan(params: {
  provider: StorageProvider
  originalKey: string
  selectedSize: PhotoWorkerSelectedSize
  hasPreset: boolean
}): PhotoWorkerObjectPlan {
  const { provider, selectedSize, hasPreset } = params
  const originalKey = normalizeObjectKey(params.originalKey)
  const thumbnailKey = replacePhotoObjectKind(originalKey, 'thumbnail')

  if (provider === 'r2') {
    return {
      previewKey: replacePhotoObjectKind(originalKey, 'preview'),
      thumbnailKey,
      selectedDerivativeKey:
        selectedSize === 'original'
          ? null
          : replacePhotoObjectKind(originalKey, selectedSize),
      shouldUploadPreview: true,
      shouldRelocateSupabaseOriginal: false,
      shouldReplaceSupabaseRawOriginal: false,
    }
  }

  const previewKey =
    selectedSize === 'original' && hasPreset
      ? replacePhotoObjectKind(originalKey, 'preview')
      : selectedSize === 'original'
        ? originalKey
        : replacePhotoObjectKind(originalKey, selectedSize)

  return {
    previewKey,
    thumbnailKey,
    selectedDerivativeKey: null,
    shouldUploadPreview: selectedSize !== 'original' || hasPreset,
    shouldRelocateSupabaseOriginal:
      selectedSize !== 'original' && previewKey !== originalKey,
    shouldReplaceSupabaseRawOriginal:
      selectedSize === 'original' && hasPreset && previewKey !== originalKey,
  }
}
