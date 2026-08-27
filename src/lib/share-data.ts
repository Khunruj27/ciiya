import { unstable_cache } from 'next/cache'
import { createClient } from '@supabase/supabase-js'

// Public share-page reads only ever need anon-key/RLS access, never a
// user's cookie session — that lets these run inside unstable_cache,
// where request-time APIs like cookies() aren't allowed.
function getAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}

const SHARE_CACHE_TTL_SECONDS = 20

export const getSharedAlbumByToken = unstable_cache(
  async (token: string) => {
    const supabase = getAnonClient()

    const { data, error } = await supabase
      .from('albums')
      .select(
        `
        id,
        title,
        description,
        cover_url,
        share_token,
        view_count,
        created_at,
        is_public,
        status,
        is_password_protected,
        password_hash
        `
      )
      .eq('share_token', token)
      .maybeSingle()

    if (error) throw new Error(error.message)

    return data
  },
  ['shared-album-by-token'],
  { revalidate: SHARE_CACHE_TTL_SECONDS }
)

const SHARE_PAGE_SIZE = 50

export const getSharedAlbumPhotos = unstable_cache(
  async (albumId: string) => {
    const supabase = getAnonClient()

    const [{ count: photoCountResult }, { data: photos, error: photosError }] =
      await Promise.all([
        supabase
          .from('photos')
          .select('id', { count: 'exact', head: true })
          .eq('album_id', albumId)
          .eq('processing_status', 'done')
          .not('preview_url', 'is', null)
          .not('thumbnail_url', 'is', null),

        supabase
          .from('photos')
          .select(
            `
            id,
            album_id,
            filename,
            public_url,
            original_url,
            preview_url,
            thumbnail_url,
            sd_url,
            hd_url,
            uhd_url,
            blur_data_url,
            storage_path,
            original_path,
            preview_path,
            thumbnail_path,
            sd_path,
            hd_path,
            uhd_path,
            selected_size,
            created_at,
            view_count,
            processing_status
            `
          )
          .eq('album_id', albumId)
          .eq('processing_status', 'done')
          .not('preview_url', 'is', null)
          .not('thumbnail_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(SHARE_PAGE_SIZE),
      ])

    if (photosError) throw new Error(photosError.message)

    return {
      photos: photos ?? [],
      photoCount: photoCountResult || 0,
    }
  },
  ['shared-album-photos'],
  { revalidate: SHARE_CACHE_TTL_SECONDS }
)

// Backs the redesign preview routes, which are gated to non-production.
// They render against a real album so a direction is judged on the
// photographer's own work rather than stock placeholders.
export async function getPreviewSample() {
  const supabase = getAnonClient()

  const { data: album, error } = await supabase
    .from('albums')
    .select('id, title, description, cover_url, view_count, created_at')
    .eq('is_public', true)
    .eq('status', 'active')
    .not('share_token', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!album) return null

  const { photos, photoCount } = await getSharedAlbumPhotos(album.id)

  return {
    album,
    photoCount,
    photos: photos
      .map((photo) => ({
        id: photo.id,
        src:
          photo.preview_url ||
          photo.hd_url ||
          photo.public_url ||
          photo.thumbnail_url ||
          '',
        alt: photo.filename || 'Photo from album',
      }))
      .filter((photo) => photo.src),
  }
}

// Cursor-paginated variant for "load more" scrolling past the first page.
// unstable_cache keys on the actual call arguments too, so each distinct
// (albumId, cursor, limit) combination gets its own cache entry — this is
// what lets many concurrent viewers scrolling the same album share one DB
// round trip per page instead of one each.
export const getSharedAlbumPhotosPage = unstable_cache(
  async (albumId: string, cursor: string | null, limit: number) => {
    const supabase = getAnonClient()

    let query = supabase
      .from('photos')
      .select(
        `
        id,
        album_id,
        filename,
        public_url,
        preview_url,
        thumbnail_url,
        blur_data_url,
        created_at,
        view_count,
        processing_status
        `
      )
      .eq('album_id', albumId)
      .eq('processing_status', 'done')
      .not('preview_url', 'is', null)
      .not('thumbnail_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    const { data, error } = await query

    if (error) throw new Error(error.message)

    const rows = data ?? []
    const hasMore = rows.length > limit

    return {
      photos: hasMore ? rows.slice(0, limit) : rows,
      hasMore,
    }
  },
  ['shared-album-photos-page'],
  { revalidate: SHARE_CACHE_TTL_SECONDS }
)
