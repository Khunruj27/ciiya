import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'
import {
  PhotoDownloadError,
  getSupabaseAdmin,
  incrementDownloadCount,
  resolvePhotoDownload,
  type DownloadAlbumRecord,
  type DownloadPhotoRecord,
} from '@/lib/photo-download'
import { recordShareEvent } from '@/lib/share-events'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Server-side cap. The gallery selects up to 5, but the endpoint enforces its
// own ceiling so a crafted request can't ask for a huge archive.
const MAX_ZIP_PHOTOS = 20

export async function POST(req: NextRequest) {
  try {
    // Zipping resizes several photos server-side, so it's heavier than a single
    // download — a tighter per-IP cap.
    const rate = await rateLimit(req, {
      bucket: 'share-download-zip',
      limit: 20,
      windowSeconds: 60,
    })

    if (!rate.allowed) {
      return tooManyRequests(rate, 'Too many downloads. Please wait a minute and try again.')
    }

    const body = await req.json().catch(() => null)
    const token = String(body?.token || '').trim()
    const photoIds = Array.isArray(body?.photoIds)
      ? body.photoIds
          .map((id: unknown) => String(id || '').trim())
          .filter((id: string) => id.length > 0 && id.length <= 100)
      : []

    if (!token || token.length > 255 || photoIds.length === 0) {
      return NextResponse.json(
        { error: 'Missing token or photoIds' },
        { status: 400 }
      )
    }

    if (photoIds.length > MAX_ZIP_PHOTOS) {
      return NextResponse.json(
        { error: `Select at most ${MAX_ZIP_PHOTOS} photos.` },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    // Resolve the album from the token first, then only pull photos that belong
    // to it — a client can never mix in photos from another album.
    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select(
        `
        id,
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
      console.error('[share/download-zip] album lookup failed:', albumError.message)
      return NextResponse.json({ error: 'Download failed' }, { status: 500 })
    }

    if (!album || !isAlbumPubliclyVisible(album as DownloadAlbumRecord)) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    const shareCookie = req.cookies.get(getShareAuthCookieName(album.id))?.value

    if (!hasValidSharePasswordAccess(album as DownloadAlbumRecord, shareCookie)) {
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
        storage_provider,
        storage_bucket,
        preview_path,
        thumbnail_path,
        sd_path,
        hd_path,
        uhd_path,
        download_count
        `
      )
      .eq('album_id', album.id)
      .in('id', photoIds)

    if (photosError) {
      console.error('[share/download-zip] photos lookup failed:', photosError.message)
      return NextResponse.json({ error: 'Download failed' }, { status: 500 })
    }

    if (!photos || photos.length === 0) {
      return NextResponse.json({ error: 'No photos found' }, { status: 404 })
    }

    const zip = new JSZip()
    const usedNames = new Set<string>()

    for (const photo of photos) {
      try {
        const { buffer, filename } = await resolvePhotoDownload({
          supabase,
          photo: photo as DownloadPhotoRecord,
          album: album as DownloadAlbumRecord,
        })

        // Avoid clobbering duplicate filenames inside the archive.
        let entryName = filename
        let counter = 1
        while (usedNames.has(entryName)) {
          const dot = filename.lastIndexOf('.')
          entryName =
            dot > 0
              ? `${filename.slice(0, dot)} (${counter})${filename.slice(dot)}`
              : `${filename} (${counter})`
          counter += 1
        }
        usedNames.add(entryName)

        zip.file(entryName, buffer)

        // Best-effort accounting; never fail the archive over it.
        void incrementDownloadCount(supabase, photo.id)
        void recordShareEvent(supabase, {
          albumId: album.id,
          ownerId: photo.owner_id || photo.user_id,
          photoId: photo.id,
          eventType: 'photo_download',
          metadata: { size: filename.match(/-(sd|hd|uhd|original)\./)?.[1] || null },
        })
      } catch (error) {
        // Skip an individual photo that can't be resolved; keep the rest.
        console.warn(
          '[share/download-zip] skipped a photo:',
          error instanceof Error ? error.message : error
        )
      }
    }

    if (usedNames.size === 0) {
      return NextResponse.json({ error: 'No downloadable photos' }, { status: 404 })
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'STORE', // JPEGs are already compressed; STORE is faster.
    })

    return new NextResponse(Uint8Array.from(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="ciiya-photos.zip"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof PhotoDownloadError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('[share/download-zip] unexpected error:', error)
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}
