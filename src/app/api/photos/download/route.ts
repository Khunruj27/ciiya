import { NextRequest, NextResponse } from 'next/server'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'
import {
  PhotoDownloadError,
  getDownloadContentDisposition,
  getSupabaseAdmin,
  incrementDownloadCount,
  resolvePhotoDownload,
  type DownloadAlbumRecord,
  type DownloadPhotoRecord,
} from '@/lib/photo-download'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const photoId = String(req.nextUrl.searchParams.get('photoId') || '').trim()
    const token = String(req.nextUrl.searchParams.get('token') || '').trim()

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
      console.error('[photos/download] photo lookup failed:', error.message)

      return NextResponse.json({ error: 'Download failed' }, { status: 500 })
    }

    if (!photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    const album = (
      Array.isArray(photo.albums) ? photo.albums[0] : photo.albums
    ) as DownloadAlbumRecord | null

    if (!album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    if (!isAlbumPubliclyVisible(album) || album.share_token !== token) {
      return NextResponse.json(
        { error: 'Invalid share link' },
        { status: 404 }
      )
    }

    const shareCookie = req.cookies.get(
      getShareAuthCookieName(album.id)
    )?.value

    if (!hasValidSharePasswordAccess(album, shareCookie)) {
      return NextResponse.json({ error: 'Password required' }, { status: 401 })
    }

    if (album.allow_download === false) {
      return NextResponse.json(
        { error: 'Download is disabled' },
        { status: 403 }
      )
    }

    const { buffer, filename, contentType } = await resolvePhotoDownload({
      supabase,
      photo: photo as DownloadPhotoRecord,
      album,
    })

    try {
      await incrementDownloadCount(supabase, photo.id)

      return new NextResponse(Uint8Array.from(buffer), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': getDownloadContentDisposition(filename),
          'Cache-Control': 'no-store',
        },
      })
    } finally {
      buffer.fill(0)
    }
  } catch (error) {
    if (error instanceof PhotoDownloadError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('[photos/download] unexpected error:', error)

    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}
