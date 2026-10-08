import { comparePhotoTimestamps, isPhotoTimestamp } from '@/lib/share-photo-pagination'

// Safe, client-visible fields only. Private originals still use the download API.
export type SharedPhoto = {
  id: string
  album_id: string
  filename: string | null
  public_url: string
  preview_url: string | null
  thumbnail_url: string | null
  blur_data_url?: string | null
  created_at: string
  updated_at?: string
  view_count?: number | null
  processing_status?: string | null
}

export type PhotoUpdateCursor = { updatedAt: string; id: string }

export const isUpdateTimestamp = isPhotoTimestamp

export function parsePhotoUpdateCursor(value: string | null): PhotoUpdateCursor | null {
  if (!value) return null
  try {
    const cursor = JSON.parse(value)
    if (typeof cursor.updatedAt !== 'string' || !isUpdateTimestamp(cursor.updatedAt) ||
      typeof cursor.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)) return null
    // Preserve Postgres microseconds: rounding to milliseconds skips tied rows.
    return { updatedAt: cursor.updatedAt, id: cursor.id }
  } catch {
    return null
  }
}

export function isReadySharedPhoto(photo: SharedPhoto) {
  return photo.processing_status === 'done' && Boolean(photo.public_url && photo.preview_url && photo.thumbnail_url)
}

export function mergeSharedPhotos<T extends SharedPhoto>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((photo) => [photo.id, photo]))
  let changed = false
  for (const photo of incoming) {
    if (!isReadySharedPhoto(photo)) continue
    const previous = byId.get(photo.id)
    if (previous?.updated_at && photo.updated_at && comparePhotoTimestamps(previous.updated_at, photo.updated_at) > 0) continue
    const next = { ...previous, ...photo }
    if (!previous || Object.keys(next).some((key) => previous[key as keyof T] !== next[key as keyof T])) {
      byId.set(photo.id, next)
      changed = true
    }
  }
  return changed
    ? [...byId.values()].sort((a, b) => comparePhotoTimestamps(b.created_at, a.created_at) || b.id.localeCompare(a.id))
    : current
}

// Overlap protects in-flight commits and makes reconnects safe; IDs deduplicate.
export function overlapPhotoUpdateTimestamp(timestamp: string) {
  return new Date(Math.max(0, Date.parse(timestamp) - 60_000)).toISOString()
}
