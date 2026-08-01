import { NextRequest, NextResponse } from 'next/server'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import sharp from 'sharp'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type DownloadSize = 'sd' | 'hd' | 'uhd' | 'original'
type SupabaseAdminClient = SupabaseClient

type AlbumRecord = {
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

type PhotoRecord = {
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
  albums?: AlbumRecord | AlbumRecord[] | null
}

const BUCKET = 'albums'
const generatingMap = new Map<string, Promise<Buffer>>()

function getSupabaseAdmin(): SupabaseAdminClient {
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

function normalizeAlbumDownloadSize(value: unknown): DownloadSize {
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

function isAllowedPhotoStoragePath(
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

  return allowedPrefixes.some((prefix) =>
    path.startsWith(prefix)
  )
}

function getWidthBySize(size: DownloadSize) {
  if (size === 'sd') return 2000
  if (size === 'uhd') return 4000
  if (size === 'original') return null
  return 3000
}

function getExistingSizePath(photo: PhotoRecord, size: DownloadSize) {
  if (size === 'sd') return photo.sd_path || null
  if (size === 'hd') return photo.hd_path || null
  if (size === 'uhd') return photo.uhd_path || null
  return photo.original_path || photo.storage_path || null
}

function getOriginalPath(photo: PhotoRecord) {
  return photo.original_path || photo.storage_path || photo.preview_path || null
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

function getSafeContentType(
  value?: string | null
) {
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

function getSafeFilename(
  photo: PhotoRecord,
  size: DownloadSize
) {
  const rawName =
    photo.filename ||
    photo.file_name ||
    `ciiya-photo-${photo.id}.jpg`

  const baseName =
    rawName.replace(/\.[^/.]+$/, '')

  const cleanedBaseName = baseName
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:"*?<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  let extension = 'jpg'

  if (size === 'original') {
    const contentType =
      getSafeContentType(photo.mime_type)

    if (contentType === 'image/png') {
      extension = 'png'
    }

    if (contentType === 'image/webp') {
      extension = 'webp'
    }
  }

  return `${
    cleanedBaseName || 'ciiya-photo'
  }-${size}.${extension}`
}

function getDownloadContentDisposition(
  filename: string
) {
  const asciiFallback = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '-')
    .replace(/["\\]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 150)

  const encodedFilename =
    encodeURIComponent(filename)
      .replace(/['()*]/g, (character) =>
        `%${character
          .charCodeAt(0)
          .toString(16)
          .toUpperCase()}`
      )

  return (
    `attachment; filename="${
      asciiFallback || 'ciiya-photo.jpg'
    }"; filename*=UTF-8''${encodedFilename}`
  )
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
    generatingPromise = generateResizedBuffer({
      originalBuffer,
      width,
    })

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
  supabase: ReturnType<typeof getSupabaseAdmin>,
  path: string
) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)

  if (error || !data) {
    throw new Error(error?.message || `File not found: ${path}`)
  }

  return Buffer.from(await data.arrayBuffer())
}

async function incrementDownloadCount(
  supabase: ReturnType<
    typeof getSupabaseAdmin
  >,
  photoId: string
) {
  const { error } = await supabase.rpc(
    'increment_photo_download_count',
    {
      target_photo_id: photoId,
    }
  )

  if (error) {
    console.error(
      '[photos/download] increment count failed:',
      error.message
    )
  }
}

async function saveGeneratedSize(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>
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
    '[photos/download] generated path update failed:',
    updateError.message
  )

  const { error: cleanupError } = await supabase.storage
    .from(BUCKET)
    .remove([path])

  if (cleanupError) {
    console.error(
      '[photos/download] generated file rollback failed:',
      cleanupError.message
    )
  }

  throw new Error('Failed to save generated image')
}
}

export async function GET(req: NextRequest) {
  try {
const photoId = String(
  req.nextUrl.searchParams.get('photoId') || ''
).trim()

const token = String(
  req.nextUrl.searchParams.get('token') || ''
).trim()

if (!photoId || !token) {
  return NextResponse.json(
    { error: 'Missing photoId or token' },
    { status: 400 }
  )
}

if (photoId.length > 100 || token.length > 255) {
  return NextResponse.json(
    { error: 'Invalid download request' },
    { status: 400 }
  )
}

    const supabase = getSupabaseAdmin()

    const { data: photo, error } = await supabase
      .from('photos')
      .select(
        `
        id,
        album_id,
        owner_id,
        user_id,
        filename,
        mime_type,
        file_name,
        storage_path,
        original_path,
        preview_path,
        thumbnail_path,
        sd_path,
        hd_path,
        uhd_path,
        download_count,
        albums!photos_album_id_fkey (
          id,
          share_token,
          is_public,
          allow_download,
          allow_original_download,
          download_size,
          status,
          is_password_protected,
          password_hash
         )
      `
      )
      .eq('id', photoId)
      .maybeSingle()

if (error) {
  console.error(
    '[photos/download] photo lookup failed:',
    error.message
  )

  return NextResponse.json(
    { error: 'Download failed' },
    { status: 500 }
  )
}

if (!photo) {
  return NextResponse.json(
    { error: 'Photo not found' },
    { status: 404 }
  )
}

    const album = Array.isArray(photo.albums) ? photo.albums[0] : photo.albums

    if (!album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    if (
  !isAlbumPubliclyVisible(album) ||
  album.share_token !== token
) {
  return NextResponse.json({ error: 'Invalid share link' }, { status: 404 })
}

    const shareCookie = req.cookies.get(
      getShareAuthCookieName(album.id)
    )?.value

    if (!hasValidSharePasswordAccess(album, shareCookie)) {
      return NextResponse.json({ error: 'Password required' }, { status: 401 })
    }

    if (album.allow_download === false) {
      return NextResponse.json({ error: 'Download is disabled' }, { status: 403 })
    }

    const ownerId =
  photo.owner_id ||
  photo.user_id ||
  null

if (!ownerId) {
  console.error(
    '[photos/download] missing photo owner:',
    photo.id
  )

  return NextResponse.json(
    { error: 'Photo not found' },
    { status: 404 }
  )
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
    typeof path === 'string' &&
    path.trim().length > 0
)

const hasInvalidPath = candidatePaths.some(
  (path) =>
    !isAllowedPhotoStoragePath(
      path,
      ownerId,
      photo.album_id
    )
)

if (hasInvalidPath) {
  console.error(
    '[photos/download] invalid storage path:',
    photo.id
  )

  return NextResponse.json(
    { error: 'Photo not found' },
    { status: 404 }
  )
}

    const size = normalizeAlbumDownloadSize(album.download_size)
    

    if (size === 'original' && album.allow_original_download !== true) {
      return NextResponse.json(
        { error: 'Original download is disabled' },
        { status: 403 }
      )
    }

    const width = getWidthBySize(size)
    const filename = getSafeFilename(photo, size)
    const contentDisposition =
  getDownloadContentDisposition(filename)
    const originalContentType = getSafeContentType(
  photo.mime_type
)

    if (size === 'original') {
      const originalPath = getOriginalPath(photo)

      if (!originalPath) {
        return NextResponse.json(
          { error: 'Original file path not found' },
          { status: 404 }
        )
      }

const originalBuffer = await downloadStorageFile(
  supabase,
  originalPath
)

try {
  await incrementDownloadCount(
  supabase,
  photo.id
)

  const responseBody = Uint8Array.from(
  originalBuffer
)

  return new NextResponse(responseBody, {
    status: 200,
    headers: {
      'Content-Type': originalContentType,
      'Content-Disposition':
          contentDisposition,
      'Cache-Control': 'no-store',
    },
  })
} finally {
  originalBuffer.fill(0)
}
    }

    const existingPath = getExistingSizePath(photo, size)

if (existingPath) {
  let existingBuffer: Buffer | null = null

  try {
    existingBuffer = await downloadStorageFile(
      supabase,
      existingPath
    )

    await incrementDownloadCount(
  supabase,
  photo.id
)

   const responseBody = Uint8Array.from(
  existingBuffer
)

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition':
             contentDisposition,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.warn(
      '[photos/download] stored generated file unavailable, regenerating:',
      error instanceof Error ? error.message : error
    )
  } finally {
    existingBuffer?.fill(0)
  }
}

    const originalPath = getOriginalPath(photo)

    if (!originalPath || !width) {
      return NextResponse.json(
        { error: 'Original file path not found' },
        { status: 404 }
      )
    }

const originalBuffer = await downloadStorageFile(
  supabase,
  originalPath
)

let resizedBuffer: Buffer | null = null

try {
  resizedBuffer = await getOrCreateGeneratedBuffer({
    cacheKey: `${photo.id}:${size}`,
    originalBuffer,
    width,
  })

  const generatedPath = makeOutputPath(
    originalPath,
    size
  )

  await saveGeneratedSize({
    supabase,
    photoId: photo.id,
    size,
    path: generatedPath,
    buffer: resizedBuffer,
  })

  await incrementDownloadCount(
  supabase,
  photo.id
)

  const responseBody = Uint8Array.from(
  resizedBuffer
)

  return new NextResponse(responseBody, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Disposition':
           contentDisposition,
      'Cache-Control': 'no-store',
    },
  })
} finally {
  originalBuffer.fill(0)
  resizedBuffer?.fill(0)
}
} catch (error) {
  console.error(
    '[photos/download] unexpected error:',
    error
  )

  return NextResponse.json(
    { error: 'Download failed' },
    { status: 500 }
  )
}
}