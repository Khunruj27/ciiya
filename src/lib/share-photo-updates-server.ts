import { createClient } from '@supabase/supabase-js'
import { resolvePhotoDeliveries } from '@/lib/storage/delivery'
import type { PhotoUpdateCursor } from '@/lib/share-photo-updates'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Uncached authorization: revocation/password changes must also apply to a
// guest who already has the gallery open. Never accept an album ID from them.
export async function getFreshShareGuard(token: string) {
  const { data, error } = await serviceClient().from('albums')
    .select('id,is_public,status,is_password_protected,password_hash')
    .eq('share_token', token).maybeSingle()
  if (error) throw error
  return data
}

export async function getSharedPhotoUpdates(albumId: string, since: string, cursor: PhotoUpdateCursor | null) {
  const limit = 100
  let query = serviceClient().from('photos')
    .select('id,album_id,filename,storage_provider,storage_bucket,public_url,preview_url,thumbnail_url,preview_path,thumbnail_path,blur_data_url,created_at,updated_at,view_count,processing_status')
    .eq('album_id', albumId).eq('processing_status', 'done')
    .gte('updated_at', since)
    .order('updated_at', { ascending: true }).order('id', { ascending: true })
    .limit(limit + 1)
  if (cursor) {
    // Both values have been validated before interpolation into PostgREST.
    query = query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []).slice(0, limit)
  const last = rows.at(-1)
  const hasMore = (data?.length ?? 0) > limit
  return {
    photos: resolvePhotoDeliveries(rows)
      .filter((photo) => photo.public_url && photo.preview_url && photo.thumbnail_url)
      .map((photo) => ({
        id: photo.id, album_id: photo.album_id, filename: photo.filename,
        public_url: photo.public_url!, preview_url: photo.preview_url,
        thumbnail_url: photo.thumbnail_url, blur_data_url: photo.blur_data_url,
        created_at: photo.created_at, updated_at: photo.updated_at,
        view_count: photo.view_count, processing_status: photo.processing_status,
      })),
    // Advance by raw rows, even if a derivative is missing. Worker completion
    // updates updated_at again; a malformed legacy row cannot stall the feed.
    latestUpdatedAt: last?.updated_at ?? null,
    nextCursor: hasMore && last ? { updatedAt: last.updated_at, id: last.id } : null,
  }
}
