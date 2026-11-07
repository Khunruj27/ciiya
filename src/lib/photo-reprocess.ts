import { randomBytes } from 'node:crypto'
import { isOwnedAlbumObjectKey, normalizeObjectKey } from './storage/paths'

/**
 * Re-rendering a finished photo (for example after a preset fix) must not reuse
 * its object keys: previews are served `immutable` for a year, so a photo
 * rewritten in place keeps showing the old image on every device that saw it.
 * Each reprocess writes new keys carrying a revision, then removes the old ones.
 */
export const PHOTO_REPROCESS_SOURCE = 'owner-reprocess'

const REVISION_PATTERN = /^[a-z0-9]{8,16}$/

/** Folders the worker writes for a photo; the raw original is never replaced. */
const DERIVED_PHOTO_FOLDERS = ['preview', 'thumbnail', 'sd', 'hd', 'uhd'] as const

/**
 * `presetPath` absent: render with the photo's current preset. A string: render
 * with that preset and store it on the photo. `null`: render without a preset.
 */
export type PhotoReprocessRequest = { revision: string; presetPath?: string | null }

/** Shape only; the worker still checks the owner/album prefix before use. */
function isPresetPathShape(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 500 && /\.xmp$/i.test(value) &&
    !value.includes('..') && !value.includes('\\') && !value.includes('//')
}

export function createPhotoReprocessRevision(): string {
  // 10 lowercase base-36 characters from 64 random bits.
  const value = randomBytes(8).readBigUInt64BE()
  return value.toString(36).padStart(10, '0').slice(-10)
}

export function isPhotoReprocessRevision(value: unknown): value is string {
  return typeof value === 'string' && REVISION_PATTERN.test(value)
}

/** The job payload a reprocess request writes and the worker reads back. */
export function photoReprocessPayload(revision: string, presetPath?: string | null) {
  if (!isPhotoReprocessRevision(revision)) throw new Error('Invalid reprocess revision')
  if (presetPath !== undefined && presetPath !== null && !isPresetPathShape(presetPath)) {
    throw new Error('Invalid reprocess preset')
  }
  return {
    source: PHOTO_REPROCESS_SOURCE,
    reprocess: true,
    revision,
    ...(presetPath === undefined ? {} : { presetPath }),
  }
}

export function readPhotoReprocessRequest(payload: unknown): PhotoReprocessRequest | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = payload as Record<string, unknown>
  if (value.source !== PHOTO_REPROCESS_SOURCE || value.reprocess !== true) return null
  if (!isPhotoReprocessRevision(value.revision)) return null
  if (!Object.hasOwn(value, 'presetPath')) return { revision: value.revision }
  if (value.presetPath === null) return { revision: value.revision, presetPath: null }
  return isPresetPathShape(value.presetPath) ? { revision: value.revision, presetPath: value.presetPath } : null
}

/**
 * A finished photo can be re-rendered only from its raw upload. Rows whose
 * original was replaced by the baked image (`original_path` under `preview/`)
 * would get the preset applied twice, so they are excluded.
 */
export function isReprocessableOriginalPath(path: unknown, ownerId: string, albumId: string) {
  if (typeof path !== 'string') return false
  return isOwnedAlbumObjectKey(path, ownerId, albumId, ['original'])
}

/**
 * The previous derived objects the new render no longer references. Keys
 * outside this album's derived folders, the original, and anything the new
 * render still uses are never returned.
 */
export function supersededPhotoObjectKeys(params: {
  ownerId: string
  albumId: string
  originalPath: string
  previous: Array<string | null | undefined>
  current: Array<string | null | undefined>
}): string[] {
  const normalize = (value: string | null | undefined) => {
    if (typeof value !== 'string' || !value.trim()) return null
    try {
      return normalizeObjectKey(value)
    } catch {
      return null
    }
  }
  const keep = new Set(
    [params.originalPath, ...params.current].map(normalize).filter((key): key is string => Boolean(key))
  )
  const result = new Set<string>()
  for (const value of params.previous) {
    const key = normalize(value)
    if (!key || keep.has(key)) continue
    if (!isOwnedAlbumObjectKey(key, params.ownerId, params.albumId, DERIVED_PHOTO_FOLDERS)) continue
    result.add(key)
  }
  return [...result]
}
