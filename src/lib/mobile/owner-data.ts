import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAlbumCoverDeliveries } from '../storage/album-covers'
import { resolvePhotoDeliveries } from '../storage/delivery'

/**
 * Read models for the Ciiya mobile app (`mobile/`). The app cannot resolve
 * photo delivery URLs itself — the R2 base URL is server configuration — so it
 * reads albums and photos through `/api/mobile/*`, which reuses the same
 * delivery helpers as the web pages. Every query is scoped to `ownerId`.
 *
 * These shapes are the app's contract (`mobile/src/lib/data/types.ts`); change
 * them only together with the app.
 */

export type MobileDownloadSize = 'sd' | 'hd' | 'uhd' | 'original'

export type MobileAlbum = {
  id: string
  title: string | null
  description: string | null
  coverUrl: string | null
  createdAt: string
  shareToken: string | null
  allowDownload: boolean
  downloadSize: MobileDownloadSize
  isPasswordProtected: boolean
  photoCount: number
}

export type MobilePhoto = {
  id: string
  filename: string | null
  thumbnailUrl: string | null
  previewUrl: string | null
  blurDataUrl: string | null
  width: number | null
  height: number | null
  isReady: boolean
  createdAt: string
}

export type MobilePhotoPage = {
  photos: MobilePhoto[]
  nextCursor: string | null
}

export const MOBILE_PHOTO_PAGE_DEFAULT = 60
export const MOBILE_PHOTO_PAGE_MAX = 120

// Explicit columns: never `*`, so password_hash and other internals stay out.
const ALBUM_COLUMNS =
  'id,title,description,cover_url,cover_photo_id,share_token,photo_count,allow_download,download_size,is_password_protected,created_at'

const PHOTO_COLUMNS =
  'id,filename,file_name,storage_provider,storage_bucket,public_url,preview_url,thumbnail_url,preview_path,thumbnail_path,blur_data_url,width,height,processing_status,created_at'

type AlbumRow = {
  id: string
  title: string | null
  description: string | null
  cover_url: string | null
  cover_photo_id: string | null
  share_token: string | null
  photo_count: number | null
  allow_download: boolean | null
  download_size: string | null
  is_password_protected: boolean | null
  created_at: string
}

type PhotoRow = {
  id: string
  filename: string | null
  file_name: string | null
  storage_provider: string | null
  storage_bucket: string | null
  public_url: string | null
  preview_url: string | null
  thumbnail_url: string | null
  preview_path: string | null
  thumbnail_path: string | null
  blur_data_url: string | null
  width: number | null
  height: number | null
  processing_status: string | null
  created_at: string
}

function normalizeDownloadSize(value: unknown): MobileDownloadSize {
  if (value === 'sd' || value === 'uhd' || value === 'original') return value
  return 'hd'
}

function toMobileAlbum(row: AlbumRow): MobileAlbum {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url || null,
    createdAt: row.created_at,
    shareToken: row.share_token || null,
    allowDownload: row.allow_download !== false,
    downloadSize: normalizeDownloadSize(row.download_size),
    isPasswordProtected: row.is_password_protected === true,
    photoCount: Math.max(0, Number(row.photo_count) || 0),
  }
}

function toMobilePhoto(row: PhotoRow): MobilePhoto {
  const hasImage = Boolean(row.thumbnail_url || row.preview_url)

  return {
    id: row.id,
    filename: row.filename || row.file_name || null,
    thumbnailUrl: row.thumbnail_url || null,
    previewUrl: row.preview_url || null,
    blurDataUrl: row.blur_data_url || null,
    width: Number(row.width) > 0 ? Number(row.width) : null,
    height: Number(row.height) > 0 ? Number(row.height) : null,
    isReady: row.processing_status === 'done' && hasImage,
    createdAt: row.created_at,
  }
}

export async function listOwnerAlbums(
  supabase: SupabaseClient,
  ownerId: string
): Promise<MobileAlbum[]> {
  const { data, error } = await supabase
    .from('albums')
    .select(ALBUM_COLUMNS)
    .eq('owner_id', ownerId)
    .or('status.is.null,status.neq.deleted')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const albums = await resolveAlbumCoverDeliveries(
    supabase,
    (data ?? []) as AlbumRow[]
  )

  return albums.map(toMobileAlbum)
}

export async function getOwnerAlbum(
  supabase: SupabaseClient,
  ownerId: string,
  albumId: string
): Promise<MobileAlbum | null> {
  const { data, error } = await supabase
    .from('albums')
    .select(ALBUM_COLUMNS)
    .eq('id', albumId)
    .eq('owner_id', ownerId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const [album] = await resolveAlbumCoverDeliveries(supabase, [
    data as AlbumRow,
  ])

  return toMobileAlbum(album)
}

/**
 * One page of an album's photos, newest first. `cursor` is the `createdAt` of
 * the last photo of the previous page. Returns null when the album is not the
 * owner's, so callers answer 404 instead of an empty list.
 */
export async function listOwnerPhotos(
  supabase: SupabaseClient,
  ownerId: string,
  albumId: string,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<MobilePhotoPage | null> {
  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select('id')
    .eq('id', albumId)
    .eq('owner_id', ownerId)
    .maybeSingle()

  if (albumError) throw new Error(albumError.message)
  if (!album) return null

  const limit = Math.min(
    Math.max(Math.trunc(options.limit || MOBILE_PHOTO_PAGE_DEFAULT), 1),
    MOBILE_PHOTO_PAGE_MAX
  )

  let query = supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .eq('album_id', albumId)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(limit + 1)

  if (options.cursor) query = query.lt('created_at', options.cursor)

  const { data, error } = await query

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as PhotoRow[]
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const photos = resolvePhotoDeliveries(pageRows).map(toMobilePhoto)

  return {
    photos,
    nextCursor:
      hasMore && pageRows.length > 0
        ? pageRows[pageRows.length - 1].created_at
        : null,
  }
}
