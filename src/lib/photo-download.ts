import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'

export type DownloadSize = 'sd' | 'hd' | 'uhd' | 'original'

export type DownloadAlbumRecord = {
  id: string
  share_token?: string | null
  is_public?: boolean | null
  allow_download?: boolean | null
  allow_original_download?: boolean | null
  download_size?: string | null
  status?: string | null
  is_password_protected?: boolean | null
  password_hash?: string | null
}

export type DownloadPhotoRecord = {
  id: string
  album_id: string
  owner_id?: string | null
  user_id?: string | null
  mime_type?: string | null
  filename?: string | null
  file_name?: string | null
  storage_path?: string | null
  original_path?: string | null
  preview_path?: string | null
  thumbnail_path?: string | null
  sd_path?: string | null
  hd_path?: string | null
  uhd_path?: string | null
  download_count?: number | null
}

const BUCKET = 'albums'
const generatingMap = new Map<string, Promise<Buffer>>()

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export function normalizeAlbumDownloadSize(value: unknown): DownloadSize {
  if (value === 'sd') return 'sd'
  if (value === 'uhd') return 'uhd'
  if (value === 'original') return 'original'
  return 'hd'
}

function hasUnsafeStoragePath(path: string) {
  const lowerPath = path.toLowerCase()

  return (
    path.includes('..') ||
    path.includes('\\') ||
    path.includes('//') ||
    lowerPath.includes('%2e') ||
    lowerPath.includes('%2f') ||
    lowerPath.includes('%5c')
  )
}

export function isAllowedPhotoStoragePath(
  path: string,
  ownerId: string,
  albumId: string
) {
  if (hasUnsafeStoragePath(path)) {
    return false
  }

  const albumPrefix = `${ownerId}/${albumId}/`

  const allowedPrefixes = [
    `${albumPrefix}original/`,
    `${albumPrefix}preview/`,
    `${albumPrefix}thumbnail/`,
    `${albumPrefix}thumbnails/`,
    `${albumPrefix}sd/`,
    `${albumPrefix}hd/`,
    `${albumPrefix}uhd/`,
  ]

  return allowedPrefixes.some((prefix) => path.startsWith(prefix))
}

function getWidthBySize(size: DownloadSize) {
  if (size === 'sd') return 2000
  if (size === 'uhd') return 4000
  if (size === 'original') return null
  return 3000
}

function getExistingSizePath(photo: DownloadPhotoRecord, size: DownloadSize) {
  if (size === 'sd') return photo.sd_path || null
  if (size === 'hd') return photo.hd_path || null
  if (size === 'uhd') return photo.uhd_path || null
  return photo.original_path || photo.storage_path || null
}

function getOriginalPath(photo: DownloadPhotoRecord) {
  return (
    photo.original_path || photo.storage_path || photo.preview_path || null
  )
}

function makeOutputPath(
  originalPath: string,
  size: Exclude<DownloadSize, 'original'>
) {
  const parts = originalPath.split('/')
  const name = parts[parts.length - 1]?.replace(/\.[^/.]+$/, '') || 'photo'

  if (parts.length >= 3) {
    return `${parts[0]}/${parts[1]}/${size}/${name}.jpg`
  }

  return `generated/${size}/${name}.jpg`
}

export function getSafeContentType(value?: string | null) {
  const normalizedValue = String(value || '')
    .trim()
    .toLowerCase()

  if (normalizedValue === 'image/png') {
    return 'image/png'
  }

  if (normalizedValue === 'image/webp') {
    return 'image/webp'
  }

  return 'image/jpeg'
}

export function getSafeFilename(
  photo: DownloadPhotoRecord,
  size: DownloadSize
) {
  const rawName =
    photo.filename || photo.file_name || `ciiya-photo-${photo.id}.jpg`

  const baseName = rawName.replace(/\.[^/.]+$/, '')

  const cleanedBaseName = baseName
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:"*?<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  let extension = 'jpg'

  if (size === 'original') {
    const contentType = getSafeContentType(photo.mime_type)

    if (contentType === 'image/png') {
      extension = 'png'
    }

    if (contentType === 'image/webp') {
      extension = 'webp'
    }
  }

  return `${cleanedBaseName || 'ciiya-photo'}-${size}.${extension}`
}

export function getDownloadContentDisposition(filename: string) {
  const asciiFallback = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '-')
    .replace(/["\\]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 150)

  const encodedFilename = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )

  return `attachment; filename="${
    asciiFallback || 'ciiya-photo.jpg'
  }"; filename*=UTF-8''${encodedFilename}`
}

async function generateResizedBuffer(params: {
  originalBuffer: Buffer
  width: number
}) {
  return sharp(params.originalBuffer)
    .rotate()
    .resize({
      width: params.width,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 90,
      mozjpeg: true,
    })
    .toBuffer()
}

async function getOrCreateGeneratedBuffer(params: {
  cacheKey: string
  originalBuffer: Buffer
  width: number
}) {
  const { cacheKey, originalBuffer, width } = params

  let generatingPromise = generatingMap.get(cacheKey)

  if (!generatingPromise) {
    generatingPromise = generateResizedBuffer({ originalBuffer, width })

    generatingMap.set(cacheKey, generatingPromise)

    void generatingPromise.finally(() => {
      if (generatingMap.get(cacheKey) === generatingPromise) {
        generatingMap.delete(cacheKey)
      }
    })
  }

  const generatedBuffer = await generatingPromise

  return Buffer.from(generatedBuffer)
}

async function downloadStorageFile(
  supabase: SupabaseClient,
  path: string
) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)

  if (error || !data) {
    throw new Error(error?.message || `File not found: ${path}`)
  }

  return Buffer.from(await data.arrayBuffer())
}

export async function incrementDownloadCount(
  supabase: SupabaseClient,
  photoId: string
) {
  const { error } = await supabase.rpc('increment_photo_download_count', {
    target_photo_id: photoId,
  })

  if (error) {
    console.error(
      '[photo-download] increment count failed:',
      error.message
    )
  }
}

async function saveGeneratedSize(params: {
  supabase: SupabaseClient
  photoId: string
  size: Exclude<DownloadSize, 'original'>
  path: string
  buffer: Buffer
}) {
  const { supabase, photoId, size, path, buffer } = params

  const upload = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: true,
  })

  if (upload.error) {
    throw new Error(upload.error.message)
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)

  const updatePayload: Record<string, unknown> = {}

  if (size === 'sd') {
    updatePayload.sd_path = path
    updatePayload.sd_url = urlData.publicUrl
  }

  if (size === 'hd') {
    updatePayload.hd_path = path
    updatePayload.hd_url = urlData.publicUrl
  }

  if (size === 'uhd') {
    updatePayload.uhd_path = path
    updatePayload.uhd_url = urlData.publicUrl
  }

  const { error: updateError } = await supabase
    .from('photos')
    .update(updatePayload)
    .eq('id', photoId)

  if (updateError) {
    console.error(
      '[photo-download] generated path update failed:',
      updateError.message
    )

    const { error: cleanupError } = await supabase.storage
      .from(BUCKET)
      .remove([path])

    if (cleanupError) {
      console.error(
        '[photo-download] generated file rollback failed:',
        cleanupError.message
      )
    }

    throw new Error('Failed to save generated image')
  }
}

export class PhotoDownloadError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Resolves the downloadable buffer for one photo at the album's configured
 * download size, validating storage-path ownership first. Shared by the
 * single-photo and batch-zip download routes so both stay in sync on size
 * selection, generated-size caching, and path security.
 */
export async function resolvePhotoDownload(params: {
  supabase: SupabaseClient
  photo: DownloadPhotoRecord
  album: DownloadAlbumRecord
}) {
  const { supabase, photo, album } = params

  const ownerId = photo.owner_id || photo.user_id || null

  if (!ownerId) {
    throw new PhotoDownloadError('Photo not found', 404)
  }

  const candidatePaths = [
    photo.storage_path,
    photo.original_path,
    photo.preview_path,
    photo.thumbnail_path,
    photo.sd_path,
    photo.hd_path,
    photo.uhd_path,
  ].filter(
    (path): path is string =>
      typeof path === 'string' && path.trim().length > 0
  )

  const hasInvalidPath = candidatePaths.some(
    (path) => !isAllowedPhotoStoragePath(path, ownerId, photo.album_id)
  )

  if (hasInvalidPath) {
    throw new PhotoDownloadError('Photo not found', 404)
  }

  const size = normalizeAlbumDownloadSize(album.download_size)

  if (size === 'original' && album.allow_original_download !== true) {
    throw new PhotoDownloadError('Original download is disabled', 403)
  }

  const width = getWidthBySize(size)
  const filename = getSafeFilename(photo, size)
  const contentType =
    size === 'original' ? getSafeContentType(photo.mime_type) : 'image/jpeg'

  if (size === 'original') {
    const originalPath = getOriginalPath(photo)

    if (!originalPath) {
      throw new PhotoDownloadError('Original file path not found', 404)
    }

    const buffer = await downloadStorageFile(supabase, originalPath)

    return { buffer, filename, contentType, size }
  }

  const existingPath = getExistingSizePath(photo, size)

  if (existingPath) {
    try {
      const buffer = await downloadStorageFile(supabase, existingPath)
      return { buffer, filename, contentType, size }
    } catch (error) {
      console.warn(
        '[photo-download] stored generated file unavailable, regenerating:',
        error instanceof Error ? error.message : error
      )
    }
  }

  const originalPath = getOriginalPath(photo)

  if (!originalPath || !width) {
    throw new PhotoDownloadError('Original file path not found', 404)
  }

  const originalBuffer = await downloadStorageFile(supabase, originalPath)

  const resizedBuffer = await getOrCreateGeneratedBuffer({
    cacheKey: `${photo.id}:${size}`,
    originalBuffer,
    width,
  })

  const generatedPath = makeOutputPath(originalPath, size)

  await saveGeneratedSize({
    supabase,
    photoId: photo.id,
    size,
    path: generatedPath,
    buffer: resizedBuffer,
  })

  return { buffer: resizedBuffer, filename, contentType, size }
}
