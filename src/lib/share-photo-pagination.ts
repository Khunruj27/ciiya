// Keep timestamps verbatim: PostgreSQL can distinguish rows by microseconds.
export type PhotoPageCursor = { createdAt: string; id: string | null }

export function isPhotoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
}

export function parsePhotoPageCursor(value: string | null): PhotoPageCursor | null {
  if (!value || value.length > 256) return null
  // Tabs opened before this fix still send a timestamp alone. Replay that
  // boundary's ties once (the gallery deduplicates IDs), then emit a full cursor.
  if (isPhotoTimestamp(value)) return { createdAt: value, id: null }
  try {
    const cursor = JSON.parse(value)
    if (typeof cursor.createdAt !== 'string' || !isPhotoTimestamp(cursor.createdAt) ||
      typeof cursor.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)) return null
    return { createdAt: cursor.createdAt, id: cursor.id }
  } catch {
    return null
  }
}

export function encodePhotoPageCursor(photo: { created_at: string; id: string }) {
  return JSON.stringify({ createdAt: photo.created_at, id: photo.id })
}

export function paginatePhotoRows<T extends { created_at: string; id: string }>(rows: T[], limit: number) {
  const page = rows.slice(0, limit)
  const hasMore = rows.length > limit
  const last = page.at(-1)
  return {
    rows: page,
    hasMore,
    // Advance using raw consumed rows, before delivery filtering. A page with
    // missing previews must not hide the ready photos on subsequent pages.
    nextCursor: hasMore && last ? encodePhotoPageCursor(last) : null,
  }
}

export function comparePhotoTimestamps(a: string, b: string) {
  const milliseconds = Date.parse(a) - Date.parse(b)
  if (!Number.isFinite(milliseconds)) return 0
  if (milliseconds !== 0) return milliseconds
  const remainder = (value: string) => Number(
    (value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || '').padEnd(6, '0').slice(3)
  )
  return remainder(a) - remainder(b)
}
