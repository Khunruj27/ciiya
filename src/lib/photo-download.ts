import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import {
  createStorageRef,
  getStorageAdapter,
  type StorageAdapter,
  type StorageProvider,
} from '@/lib/storage'
import {
  buildPhotoDownloadStoragePlan,
  normalizePhotoStorageProvider,
} from '@/lib/storage/photo-download-plan'

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
  storage_provider?: string | null
  storage_bucket?: string | null
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

// The master to resize smaller download sizes FROM. It must be the
// preset-baked, selected-size image (preview_path / storage_path both hold it),
// never the raw original — resizing from the raw produced downloads without the
// photographer's preset while the gallery/lightbox (which use preview_url)
// showed it. withoutEnlargement in the resizer caps upscaling to the master.
function getResizeSourcePath(photo: DownloadPhotoRecord) {
  return (
    photo.preview_path || photo.storage_path || photo.original_path || null
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

async function downloadStorageFile(params: {
  adapter: StorageAdapter
  storageProvider: StorageProvider
  storageBucket: string | null
  path: string
}) {
  const plan = buildPhotoDownloadStoragePlan({
    storageProvider: params.storageProvider,
    storageBucket: params.storageBucket,
    path: params.path,
  })
  let lastError: unknown

  for (const bucket of plan.buckets) {
    try {
      return await params.adapter.downloadObject(
        createStorageRef({
          provider: plan.provider,
          bucket,
          key: params.path,
        })
      )
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`File not found: ${params.path}`)
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
  adapter: StorageAdapter
  storageProvider: StorageProvider
  storageBucket: string | null
  photoId: string
  size: Exclude<DownloadSize, 'original'>
  path: string
  buffer: Buffer
}) {
  const {
    supabase,
    adapter,
    storageProvider,
    storageBucket,
    photoId,
    size,
    path,
    buffer,
  } = params
  const bucket = storageProvider === 'r2' ? storageBucket : BUCKET

  if (!bucket) {
    throw new Error('R2 photo is missing storage_bucket')
  }

  const objectRef = createStorageRef({
    provider: storageProvider,
    bucket,
    key: path,
  })

  await adapter.uploadObject(objectRef, buffer, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: true,
  })

  // R2 delivery tiers stay private and are returned only through this
  // authorized endpoint. Supabase keeps its legacy public derivative URLs.
  const generatedUrl =
    storageProvider === 'supabase'
      ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
      : null

  const updatePayload: Record<string, unknown> = {}

  if (size === 'sd') {
    updatePayload.sd_path = path
    updatePayload.sd_url = generatedUrl
  }

  if (size === 'hd') {
    updatePayload.hd_path = path
    updatePayload.hd_url = generatedUrl
  }

  if (size === 'uhd') {
    updatePayload.uhd_path = path
    updatePayload.uhd_url = generatedUrl
  }

  updatePayload.updated_at = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('photos')
    .update(updatePayload)
    .eq('id', photoId)

  if (updateError) {
    console.error(
      '[photo-download] generated path update failed:',
      updateError.message
    )

    // Keep the deterministic object for an idempotent retry. Deleting here
    // could remove an object committed by a concurrent download request.
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
 * download size, validating storage-path ownership first.
 */
export async function resolvePhotoDownload(params: {
  supabase: SupabaseClient
  photo: DownloadPhotoRecord
  album: DownloadAlbumRecord
  storageAdapter?: StorageAdapter
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

  let storageProvider: StorageProvider

  try {
    storageProvider = normalizePhotoStorageProvider(photo.storage_provider)
  } catch {
    throw new PhotoDownloadError('Photo not found', 404)
  }

  const storageBucket = photo.storage_bucket?.trim() || null

  if (storageProvider === 'r2' && !storageBucket) {
    throw new PhotoDownloadError('Photo not found', 404)
  }

  const adapter =
    params.storageAdapter ||
    getStorageAdapter(
      storageProvider,
      storageProvider === 'supabase' ? { supabase } : {}
    )

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

    const buffer = await downloadStorageFile({
      adapter,
      storageProvider,
      storageBucket,
      path: originalPath,
    })

    return { buffer, filename, contentType, size }
  }

  const existingPath = getExistingSizePath(photo, size)

  if (existingPath) {
    try {
      const buffer = await downloadStorageFile({
        adapter,
        storageProvider,
        storageBucket,
        path: existingPath,
      })
      return { buffer, filename, contentType, size }
    } catch (error) {
      console.warn(
        '[photo-download] stored generated file unavailable, regenerating:',
        error instanceof Error ? error.message : error
      )
    }
  }

  const sourcePath = getResizeSourcePath(photo)

  if (!sourcePath || !width) {
    throw new PhotoDownloadError('Original file path not found', 404)
  }

  const sourceBuffer = await downloadStorageFile({
    adapter,
    storageProvider,
    storageBucket,
    path: sourcePath,
  })
  let resizedBuffer: Buffer

  try {
    resizedBuffer = await getOrCreateGeneratedBuffer({
      cacheKey: `${storageProvider}:${photo.id}:${size}`,
      originalBuffer: sourceBuffer,
      width,
    })
  } finally {
    sourceBuffer.fill(0)
  }

  const generatedPath = makeOutputPath(sourcePath, size)

  try {
    await saveGeneratedSize({
      supabase,
      adapter,
      storageProvider,
      storageBucket,
      photoId: photo.id,
      size,
      path: generatedPath,
      buffer: resizedBuffer,
    })
  } catch (error) {
    resizedBuffer.fill(0)
    throw error
  }

  return { buffer: resizedBuffer, filename, contentType, size }
}
