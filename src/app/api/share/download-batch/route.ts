import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'
import {
  getSupabaseAdmin,
  incrementDownloadCount,
  resolvePhotoDownload,
  type DownloadAlbumRecord,
  type DownloadPhotoRecord,
} from '@/lib/photo-download'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BATCH_SIZE = 10

function getDownloadContentDisposition(filename: string) {
  const asciiFallback = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '-')
    .replace(/["\\]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 150)

  return `attachment; filename="${asciiFallback || 'ciiya-photos.zip'}"`
}

function dedupeZipFilename(usedNames: Set<string>, filename: string) {
  if (!usedNames.has(filename)) {
    usedNames.add(filename)
    return filename
  }

  const dotIndex = filename.lastIndexOf('.')
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : ''

  let attempt = 2
  let candidate = `${base} (${attempt})${extension}`

  while (usedNames.has(candidate)) {
    attempt += 1
    candidate = `${base} (${attempt})${extension}`
  }

  usedNames.add(candidate)
  return candidate
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)

    const token = String(body?.token || '').trim()
    const photoIds = Array.isArray(body?.photoIds) ? body.photoIds : []

    const safePhotoIds = photoIds
      .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id: string) => id.trim())
      .slice(0, MAX_BATCH_SIZE)

    if (!token || token.length > 255) {
      return NextResponse.json({ error: 'Missing share token' }, { status: 400 })
    }

    if (safePhotoIds.length === 0) {
      return NextResponse.json({ error: 'No photos selected' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select(
        `
        id,
        title,
        share_token,
        is_public,
        allow_download,
        allow_original_download,
        download_size,
        status,
        is_password_protected,
        password_hash
        `
      )
      .eq('share_token', token)
      .maybeSingle()

    if (albumError) {
      console.error('[share/download-batch] album lookup failed:', albumError.message)
      return NextResponse.json({ error: 'Download failed' }, { status: 500 })
    }

    if (!album || !isAlbumPubliclyVisible(album)) {
      return NextResponse.json({ error: 'Shared album not found' }, { status: 404 })
    }

    const shareCookie = req.cookies.get(getShareAuthCookieName(album.id))?.value

    if (!hasValidSharePasswordAccess(album, shareCookie)) {
      return NextResponse.json({ error: 'Password required' }, { status: 401 })
    }

    if (album.allow_download === false) {
      return NextResponse.json({ error: 'Download is disabled' }, { status: 403 })
    }

    const { data: photos, error: photosError } = await supabase
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
        uhd_path
        `
      )
      .eq('album_id', album.id)
      .in('id', safePhotoIds)

    if (photosError) {
      console.error('[share/download-batch] photo lookup failed:', photosError.message)
      return NextResponse.json({ error: 'Download failed' }, { status: 500 })
    }

    if (!photos || photos.length === 0) {
      return NextResponse.json({ error: 'Photos not found' }, { status: 404 })
    }

    const zip = new JSZip()
    const usedNames = new Set<string>()
    let successCount = 0

    for (const photo of photos as DownloadPhotoRecord[]) {
      try {
        const { buffer, filename } = await resolvePhotoDownload({
          supabase,
          photo,
          album: album as DownloadAlbumRecord,
        })

        zip.file(dedupeZipFilename(usedNames, filename), buffer)
        successCount += 1

        void incrementDownloadCount(supabase, photo.id)
      } catch (error) {
        console.error(
          '[share/download-batch] skipped photo:',
          photo.id,
          error instanceof Error ? error.message : error
        )
      }
    }

    if (successCount === 0) {
      return NextResponse.json({ error: 'Download failed' }, { status: 500 })
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const zipFilename = `${(album.title || 'ciiya-photos')
      .replace(/[\\/:"*?<>|]/g, '-')
      .trim()
      .slice(0, 80) || 'ciiya-photos'}.zip`

    return new NextResponse(Uint8Array.from(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': getDownloadContentDisposition(zipFilename),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[share/download-batch] unexpected error:', error)
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}
