import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function uniquePaths(paths: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      paths
        .filter(Boolean)
        .map((path) => String(path).trim())
        .filter(Boolean)
    )
  )
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const photoId = String(body?.photoId || '').trim()

    if (!photoId) {
      return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
    }

    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select(
        `
        id,
        album_id,
        owner_id,
        storage_path,
        original_path,
        preview_path,
        thumbnail_path,
        sd_path,
        hd_path,
        uhd_path
      `
      )
      .eq('id', photoId)
      .eq('owner_id', user.id)
      .single()

    if (photoError || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    const { data: albumsUsingCover } = await supabase
      .from('albums')
      .select('id')
      .eq('cover_photo_id', photoId)
      .eq('owner_id', user.id)

    if (albumsUsingCover && albumsUsingCover.length > 0) {
      const albumIds = albumsUsingCover.map((album) => album.id)

      const { error: coverResetError } = await supabase
        .from('albums')
        .update({
          cover_photo_id: null,
          cover_url: null,
        })
        .in('id', albumIds)
        .eq('owner_id', user.id)

      if (coverResetError) {
        return NextResponse.json(
          { error: coverResetError.message },
          { status: 500 }
        )
      }
    }

    await supabase
      .from('worker_logs')
      .delete()
      .eq('photo_id', photoId)
      .eq('owner_id', user.id)

    await supabase
      .from('photo_jobs')
      .delete()
      .eq('photo_id', photoId)
      .eq('owner_id', user.id)

    const pathsToRemove = uniquePaths([
      photo.storage_path,
      photo.original_path,
      photo.preview_path,
      photo.thumbnail_path,
      photo.sd_path,
      photo.hd_path,
      photo.uhd_path,
    ])

    let storageErrorMessage: string | null = null

    if (pathsToRemove.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('albums')
        .remove(pathsToRemove)

      if (storageError) {
        storageErrorMessage = storageError.message
        console.error('Delete photo storage error:', storageError.message)
      }
    }

    const { error: deleteError } = await supabase
      .from('photos')
      .delete()
      .eq('id', photoId)
      .eq('owner_id', user.id)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      deletedFiles: pathsToRemove.length,
      storageWarning: storageErrorMessage,
    })
  } catch (error) {
    console.error('Delete photo error:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Delete failed',
      },
      { status: 500 }
    )
  }
}