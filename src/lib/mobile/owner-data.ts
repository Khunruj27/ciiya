import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAlbumCoverDeliveries } from '../storage/album-covers'
import { resolvePhotoDeliveries } from '../storage/delivery'
import {
  paginatePhotoRows,
  parsePhotoPageCursor,
} from '../share-photo-pagination'

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
  /** The album's upload defaults, so phone uploads behave like web uploads. */
  autoFaceScan: boolean
  autoPublish: boolean
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
  processingStatus: 'pending' | 'processing' | 'done' | 'failed' | 'cancelled' | 'uploading' | 'finalizing' | 'unknown'
  processingProgress: number | null
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
  'id,title,description,cover_url,cover_photo_id,share_token,photo_count,allow_download,download_size,is_password_protected,auto_face_scan,auto_publish,created_at'

const PHOTO_COLUMNS =
  'id,filename,file_name,storage_provider,storage_bucket,public_url,preview_url,thumbnail_url,preview_path,thumbnail_path,blur_data_url,width,height,processing_status,processing_progress,created_at'

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
  auto_face_scan: boolean | null
  auto_publish: boolean | null
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
  processing_progress: number | null
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
    autoFaceScan: row.auto_face_scan !== false,
    autoPublish: row.auto_publish === true,
  }
}

function toMobilePhoto(row: PhotoRow): MobilePhoto {
  const hasImage = Boolean(row.thumbnail_url || row.preview_url)
  const status = row.processing_status
  const processingStatus = status === 'pending' || status === 'processing' || status === 'done' ||
    status === 'failed' || status === 'cancelled' || status === 'uploading' || status === 'finalizing'
    ? status : 'unknown'
  const progress = row.processing_progress

  return {
    id: row.id,
    filename: row.filename || row.file_name || null,
    thumbnailUrl: row.thumbnail_url || null,
    previewUrl: row.preview_url || null,
    blurDataUrl: row.blur_data_url || null,
    width: Number(row.width) > 0 ? Number(row.width) : null,
    height: Number(row.height) > 0 ? Number(row.height) : null,
    isReady: row.processing_status === 'done' && hasImage,
    processingStatus,
    processingProgress: processingStatus === 'processing' && typeof progress === 'number' &&
      Number.isFinite(progress) && progress >= 0 && progress <= 100 ? Math.round(progress) : null,
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
 * One page of an album's photos, newest first by (created_at, id). Timestamp
 * ties are common with batch uploads, so a timestamp alone is not a boundary.
 * Older clients' timestamp cursors replay that boundary once, then receive a
 * tuple cursor. `photoIds` reads a bounded set of processing updates without
 * walking every page. Every path checks the owner and album independently.
 */
export async function listOwnerPhotos(
  supabase: SupabaseClient,
  ownerId: string,
  albumId: string,
  options: { cursor?: string | null; limit?: number; photoIds?: string[] } = {}
): Promise<MobilePhotoPage | null> {
  const cursor = parsePhotoPageCursor(options.cursor ?? null)
  if (options.cursor && !cursor) throw new Error('Invalid cursor')
  if (options.photoIds && (
    options.photoIds.length === 0 ||
    options.photoIds.length > MOBILE_PHOTO_PAGE_MAX ||
    options.photoIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  )) throw new Error('Invalid photo IDs')

  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select('id')
    .eq('id', albumId)
    .eq('owner_id', ownerId)
    .maybeSingle()

  if (albumError) throw new Error(albumError.message)
  if (!album) return null

  const limit = Math.min(
    Math.max(Math.trunc(Number.isFinite(options.limit) ? options.limit! : MOBILE_PHOTO_PAGE_DEFAULT), 1),
    MOBILE_PHOTO_PAGE_MAX
  )

  let query = supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .eq('album_id', albumId)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (options.photoIds) {
    query = query.in('id', options.photoIds).limit(MOBILE_PHOTO_PAGE_MAX)
  } else {
    query = query.limit(limit + 1)
    if (cursor) {
      query = cursor.id
        ? query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
        : query.lte('created_at', cursor.createdAt)
    }
  }

  const { data, error } = await query

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as PhotoRow[]
  const { rows: pageRows, nextCursor } = options.photoIds
    ? { rows, nextCursor: null }
    : paginatePhotoRows(rows, limit)
  const photos = resolvePhotoDeliveries(pageRows).map(toMobilePhoto)

  return {
    photos,
    nextCursor,
  }
}
