import { NextRequest, NextResponse } from 'next/server'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import sharp from 'sharp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type DownloadSize = 'sd' | 'hd' | 'uhd' | 'original'
type SupabaseAdminClient = SupabaseClient

type AlbumRecord = {
  id: string
  allow_download?: boolean | null
  allow_original_download?: boolean | null
  download_size?: string | null
  status?: string | null
}

type PhotoRecord = {
  id: string
  album_id: string
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

function getSafeFilename(photo: PhotoRecord, size: DownloadSize) {
  const rawName =
    photo.filename || photo.file_name || `ciiya-photo-${photo.id}.jpg`

  const baseName = rawName.replace(/\.[^/.]+$/, '')

  const safeBase = baseName
    .replace(/[^a-zA-Z0-9-_ก-๙]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)

  return `${safeBase || 'ciiya-photo'}-${size}.jpg`
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
  }

  try {
    return await generatingPromise
  } finally {
    generatingMap.delete(cacheKey)
  }
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
  supabase: ReturnType<typeof getSupabaseAdmin>,
  photoId: string,
  currentCount: number | null
) {
  await supabase
    .from('photos')
    .update({
      download_count: Number(currentCount || 0) + 1,
    })
    .eq('id', photoId)
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

  await supabase.from('photos').update(updatePayload).eq('id', photoId)
}

export async function GET(req: NextRequest) {
  try {
    const photoId = req.nextUrl.searchParams.get('photoId')

    if (!photoId) {
      return NextResponse.json({ error: 'Missing photoId' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data: photo, error } = await supabase
      .from('photos')
      .select(
        `
        id,
        album_id,
        filename,
        file_name,
        storage_path,
        original_path,
        preview_path,
        thumbnail_path,
        sd_path,
        hd_path,
        uhd_path,
        download_count,
        albums!inner (
          id,
          allow_download,
          allow_original_download,
          download_size,
          status
        )
      `
      )
      .eq('id', photoId)
      .maybeSingle()

    if (error || !photo) {
      return NextResponse.json(
        { error: error?.message || 'Photo not found' },
        { status: 404 }
      )
    }

    const album = Array.isArray(photo.albums) ? photo.albums[0] : photo.albums

    if (!album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    if (album.allow_download === false) {
      return NextResponse.json({ error: 'Download is disabled' }, { status: 403 })
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

    if (size === 'original') {
      const originalPath = getOriginalPath(photo)

      if (!originalPath) {
        return NextResponse.json(
          { error: 'Original file path not found' },
          { status: 404 }
        )
      }

      const originalBuffer = await downloadStorageFile(supabase, originalPath)

      await incrementDownloadCount(supabase, photo.id, photo.download_count)

      return new NextResponse(new Uint8Array(originalBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const existingPath = getExistingSizePath(photo, size)

    if (existingPath) {
      try {
        const existingBuffer = await downloadStorageFile(supabase, existingPath)

        await incrementDownloadCount(supabase, photo.id, photo.download_count)

        return new NextResponse(new Uint8Array(existingBuffer), {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
          },
        })
      } catch {
        // ถ้า path มีใน DB แต่ไฟล์หาย ให้ generate ใหม่จาก original ต่อด้านล่าง
      }
    }

    const originalPath = getOriginalPath(photo)

    if (!originalPath || !width) {
      return NextResponse.json(
        { error: 'Original file path not found' },
        { status: 404 }
      )
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

    await incrementDownloadCount(supabase, photo.id, photo.download_count)

    return new NextResponse(new Uint8Array(resizedBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Download failed',
      },
      { status: 500 }
    )
  }
}