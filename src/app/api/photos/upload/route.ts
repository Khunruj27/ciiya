import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'

export const runtime = 'nodejs'

async function getStorageUsageAndLimit(userId: string) {
  const supabase = await createServerSupabaseClient()

  const { data: storageRowsData, error: storageError } = await supabase
    .from('photos')
    .select('file_size_bytes')
    .eq('owner_id', userId)

  if (storageError) {
    throw new Error(storageError.message)
  }

  const storageRows = storageRowsData ?? []

  const usedBytes = storageRows.reduce((sum, row) => {
    return sum + Number(row.file_size_bytes || 0)
  }, 0)

  const { storageLimitBytes } = await getUserStoragePlan(userId)

  return {
    usedBytes,
    limitBytes: Number(storageLimitBytes || 3 * 1024 * 1024 * 1024),
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()

    const file = formData.get('file') as File | null
    const albumId = String(formData.get('albumId') || '').trim()
    const size = String(formData.get('size') || 'original').trim().toLowerCase()
    const categoryIdRaw = String(formData.get('categoryId') || '').trim()
    const categoryId = categoryIdRaw || null
    const isCover = String(formData.get('isCover') || '') === 'true'

    if (!file || !albumId) {
      return NextResponse.json(
        { error: 'Missing file or albumId' },
        { status: 400 }
      )
    }

    const fileNameLower = file.name.toLowerCase()

    const isImage =
      file.type.startsWith('image/') ||
      fileNameLower.endsWith('.jpg') ||
      fileNameLower.endsWith('.jpeg') ||
      fileNameLower.endsWith('.png')

    if (!isImage) {
      return NextResponse.json(
        { error: 'Only image files are allowed' },
        { status: 400 }
      )
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, owner_id, cover_url')
      .eq('id', albumId)
      .eq('owner_id', user.id)
      .single()

    if (albumError || !album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    const baseName = file.name.replace(/\.[^/.]+$/, '')
    const safeBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '-')
    const fileName = `${Date.now()}-${safeBaseName || 'photo'}.jpg`

    const arrayBuffer = await file.arrayBuffer()
    let buffer = Buffer.from(new Uint8Array(arrayBuffer))

    if (!isCover && size !== 'original') {
      const sharpModule = await import('sharp')
      const sharp = sharpModule.default

      let width = 2000

      if (size === 'hd') width = 3000
      if (size === 'uhd') width = 4000
      if (size === 'sd') width = 2000

      buffer = await sharp(buffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
    } else {
      const sharpModule = await import('sharp')
      const sharp = sharpModule.default

      buffer = await sharp(buffer)
        .rotate()
        .jpeg({ quality: 90 })
        .toBuffer()
    }

    const fileSizeBytes = buffer.length

    if (!isCover) {
      const { usedBytes, limitBytes } = await getStorageUsageAndLimit(user.id)

      if (usedBytes + fileSizeBytes > limitBytes) {
        return NextResponse.json(
          {
            error: 'Storage full. Please upgrade your plan.',
            usedBytes,
            limitBytes,
            fileSizeBytes,
          },
          { status: 400 }
        )
      }
    }

    const storagePath = isCover
      ? `${user.id}/${albumId}/cover/${fileName}`
      : `${user.id}/${albumId}/photos/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('albums')
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const { data: publicUrlData } = supabase.storage
      .from('albums')
      .getPublicUrl(storagePath)

    const publicUrl = publicUrlData.publicUrl

    if (isCover) {
      const { error: coverError } = await supabase
        .from('albums')
        .update({ cover_url: publicUrl })
        .eq('id', albumId)
        .eq('owner_id', user.id)

      if (coverError) {
        return NextResponse.json({ error: coverError.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        coverUrl: publicUrl,
      })
    }

    const { data: insertedPhoto, error: insertError } = await supabase
      .from('photos')
      .insert({
        album_id: albumId,
        owner_id: user.id,
        filename: file.name,
        storage_path: storagePath,
        public_url: publicUrl,
        category_id: categoryId,
        file_size_bytes: fileSizeBytes,
      })
      .select('id, public_url')
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    if (!album.cover_url && insertedPhoto?.public_url) {
      const { error: autoCoverError } = await supabase
        .from('albums')
        .update({ cover_url: insertedPhoto.public_url })
        .eq('id', albumId)
        .eq('owner_id', user.id)

      if (autoCoverError) {
        return NextResponse.json(
          { error: autoCoverError.message },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      publicUrl,
      photoId: insertedPhoto?.id ?? null,
      fileSizeBytes,
    })
  } catch (error) {
    console.error('Upload route error:', error)

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}