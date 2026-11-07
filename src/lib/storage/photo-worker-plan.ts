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
  kind: PhotoObjectKind,
  revision?: string | null
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

  const suffix = revision ? `-${revision}` : ''
  return `${parts[0]}/${parts[1]}/${kind}/${objectName}${suffix}.jpg`
}

/**
 * Builds the provider-specific object plan without performing any storage I/O.
 *
 * Supabase preserves the legacy behavior during the dual-provider migration.
 * R2 always separates the public display preview from private originals and
 * private delivery tiers, including albums configured for original download.
 *
 * A reprocess passes a `revision`, which gives every derived object a new key
 * so CDN- and device-cached copies of the previous render are never reused.
 */
export function buildPhotoWorkerObjectPlan(params: {
  provider: StorageProvider
  originalKey: string
  selectedSize: PhotoWorkerSelectedSize
  hasPreset: boolean
  revision?: string | null
}): PhotoWorkerObjectPlan {
  const { provider, selectedSize, hasPreset } = params
  const revision = params.revision || null
  if (revision && !/^[a-z0-9]{8,16}$/.test(revision)) {
    throw new Error('Invalid photo revision')
  }
  const originalKey = normalizeObjectKey(params.originalKey)
  const derived = (kind: PhotoObjectKind) =>
    replacePhotoObjectKind(originalKey, kind, revision)
  const thumbnailKey = derived('thumbnail')

  if (provider === 'r2') {
    return {
      previewKey: derived('preview'),
      thumbnailKey,
      selectedDerivativeKey:
        selectedSize === 'original'
          ? null
          : derived(selectedSize),
      shouldUploadPreview: true,
      shouldRelocateSupabaseOriginal: false,
      shouldReplaceSupabaseRawOriginal: false,
    }
  }

  const previewKey =
    selectedSize === 'original' && hasPreset
      ? derived('preview')
      : selectedSize === 'original'
        ? originalKey
        : derived(selectedSize)

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
