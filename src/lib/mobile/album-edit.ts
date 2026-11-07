import { NextResponse } from 'next/server'
import { resolvePublicStorageUrl } from '@/lib/storage/delivery'
import { assertOwnedAlbumObjectKey } from '@/lib/storage/paths'
import { normalizePhotoStorageProvider } from '@/lib/storage/photo-download-plan'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export function albumEditJson(body: { success: true } | { error: string }, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export function isAlbumEditId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return false

  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

/** This contract cannot change password, download, publication or ownership flags. */
export function readAlbumDetails(value: unknown) {
  if (!hasExactKeys(value, ['title', 'description'])) return null
  if (typeof value.title !== 'string' || typeof value.description !== 'string') return null

  const title = value.title.trim()
  if (!title || title.length > 120 || value.description.length > 500) return null

  return { title, description: value.description.trim() || null }
}

export function readAlbumCoverPhotoId(value: unknown) {
  if (!hasExactKeys(value, ['photoId']) || !isAlbumEditId(value.photoId)) return null
  return value.photoId.toLowerCase()
}

type CoverPhotoPaths = {
  storage_provider?: unknown
  storage_bucket?: string | null
  preview_path?: string | null
  thumbnail_path?: string | null
}

/**
 * Derive a cover only from owned public preview/thumbnail object paths.
 * Stored URLs are deliberately not read: they may be stale, signed, private,
 * or an original URL. This does not access objects or alter storage gates.
 */
export function resolveAlbumEditCoverUrl(photo: CoverPhotoPaths, ownerId: string, albumId: string) {
  let provider: ReturnType<typeof normalizePhotoStorageProvider>
  try {
    provider = normalizePhotoStorageProvider(photo.storage_provider)
  } catch {
    return null
  }

  for (const [kind, path] of [
    ['preview', photo.preview_path],
    ['thumbnail', photo.thumbnail_path],
  ] as const) {
    if (typeof path !== 'string') continue

    try {
      const key = assertOwnedAlbumObjectKey(path, ownerId, albumId, [kind])
      // An object leaf must be in this derivative folder, not a nested path.
      if (key.split('/').length !== 4) continue

      const resolved = resolvePublicStorageUrl({
        provider,
        // Legacy photo rows can name the private originals bucket. Derivatives
        // are public only in albums, matching the existing delivery contract.
        bucket: provider === 'supabase' ? 'albums' : photo.storage_bucket,
        key,
      })
      if (!resolved) continue

      const url = new URL(resolved)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.toString() !== resolved
      ) continue

      return resolved
    } catch {
      // Unsafe metadata/configuration must fail closed without logging paths.
    }
  }

  return null
}
