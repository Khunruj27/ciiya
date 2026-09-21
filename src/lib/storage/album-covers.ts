import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePhotoDeliveries } from './delivery'

export type AlbumCoverRecord = {
  cover_photo_id?: string | null
  cover_url?: string | null
}

/**
 * Rehydrates album cover URLs from the current photo provider. The stored
 * album.cover_url remains a compatibility fallback while copied Supabase
 * objects are intentionally retained during migration.
 */
export async function resolveAlbumCoverDeliveries<T extends AlbumCoverRecord>(
  supabase: SupabaseClient,
  albums: T[]
): Promise<T[]> {
  const coverPhotoIds = Array.from(
    new Set(
      albums
        .map((album) => album.cover_photo_id)
        .filter((id): id is string => Boolean(id))
    )
  )

  if (coverPhotoIds.length === 0) return albums

  const { data, error } = await supabase
    .from('photos')
    .select(
      'id, storage_provider, storage_bucket, public_url, preview_url, thumbnail_url, preview_path, thumbnail_path'
    )
    .in('id', coverPhotoIds)

  if (error) {
    console.warn(
      '[storage] unable to resolve album cover delivery:',
      error.message
    )
    return albums
  }

  const deliveryByPhotoId = new Map(
    resolvePhotoDeliveries(data || []).map((photo) => [photo.id, photo])
  )

  return albums.map((album) => {
    const photo = album.cover_photo_id
      ? deliveryByPhotoId.get(album.cover_photo_id)
      : null

    return {
      ...album,
      cover_url:
        photo?.preview_url ||
        photo?.thumbnail_url ||
        photo?.public_url ||
        album.cover_url ||
        null,
    }
  })
}
