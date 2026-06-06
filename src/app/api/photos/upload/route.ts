import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const DEFAULT_LIMIT_BYTES = 20 * 1024 * 1024 * 1024
const STORAGE_BUCKET = 'albums'

type UploadSize = 'sd' | 'hd' | 'uhd' | 'original'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return null
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function getSafeUploadSize(value: string): UploadSize {
  const safeValue = value.trim().toLowerCase()

  if (
    safeValue === 'sd' ||
    safeValue === 'hd' ||
    safeValue === 'uhd' ||
    safeValue === 'original'
  ) {
    return safeValue
  }

  return 'original'
}

function getFileHash(buffer: Buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex')
}

function getSafeFileName(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg'

  const baseName = fileName.replace(/\.[^/.]+$/, '')

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  const randomPart = crypto.randomBytes(6).toString('hex')

  return `${Date.now()}-${randomPart}-${safeBaseName || 'photo'}.${ext}`
}

function getSafePresetName(fileName: string) {
  const baseName = fileName.replace(/\.[^/.]+$/, '')

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  const randomPart = crypto.randomBytes(6).toString('hex')

  return `${Date.now()}-${randomPart}-${safeBaseName || 'preset'}.xmp`
}

async function getStorageUsageAndLimit(userId: string) {
  const supabase = await createServerSupabaseClient()

  const { data: usage } = await supabase
    .from('user_storage_usage')
    .select('used_bytes, storage_used_bytes, storage_limit_bytes')
    .eq('user_id', userId)
    .maybeSingle()

  let usedBytes = Number(
    usage?.storage_used_bytes ??
      usage?.used_bytes ??
      0
  )

  if (!usedBytes) {
    const { data, error } = await supabase
      .from('photos')
      .select(`
        original_size_bytes,
        file_size_bytes,
        preview_size_bytes,
        thumbnail_size_bytes
      `)
      .or(`owner_id.eq.${userId},user_id.eq.${userId}`)

    if (error) {
      throw new Error(error.message)
    }

    usedBytes = (data ?? []).reduce((sum, row) => {
      return (
        sum +
        Number(row.original_size_bytes || row.file_size_bytes || 0) +
        Number(row.preview_size_bytes || 0) +
        Number(row.thumbnail_size_bytes || 0)
      )
    }, 0)
  }

  const { storageLimitBytes } = await getUserStoragePlan(userId)

  const limitBytes = Number(
    usage?.storage_limit_bytes ||
      storageLimitBytes ||
      DEFAULT_LIMIT_BYTES
  )

  return {
    usedBytes,
    limitBytes,
  }
}

async function findDuplicatePhoto(params: {
  albumId: string
  userId: string
  fileHash: string
}) {
  const { albumId, userId, fileHash } = params

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('photos')
    .select(`
      id,
      public_url,
      original_url,
      preview_url,
      thumbnail_url,
      processing_status
    `)
    .eq('album_id', albumId)
    .eq('file_hash', fileHash)
    .or(`owner_id.eq.${userId},user_id.eq.${userId}`)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function POST(req: NextRequest) {
  let uploadedStoragePath: string | null = null

  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const formData = await req.formData()

    const file = formData.get('file') as File | null
    const presetFile = formData.get('presetFile') as File | null

    const albumId = String(formData.get('albumId') || '').trim()

    const size = getSafeUploadSize(
      String(formData.get('size') || 'original')
    )

    const categoryIdRaw = String(
      formData.get('categoryId') || ''
    ).trim()

    const categoryId = categoryIdRaw || null

    const isCover =
      String(formData.get('isCover') || '') === 'true'

    if (!file || !albumId) {
      return NextResponse.json(
        { error: 'Missing file or albumId' },
        { status: 400 }
      )
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: 'File too large. Maximum 100MB allowed.',
        },
        { status: 400 }
      )
    }

    const fileNameLower = file.name.toLowerCase()

    const allowedExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
    ]

    const isImage =
      file.type.startsWith('image/') ||
      allowedExtensions.some((ext) =>
        fileNameLower.endsWith(ext)
      )

    if (!isImage) {
      return NextResponse.json(
        { error: 'Only image files are allowed' },
        { status: 400 }
      )
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, owner_id, user_id, cover_url')
      .eq('id', albumId)
      .or(`owner_id.eq.${user.id},user_id.eq.${user.id}`)
      .single()

    if (albumError || !album) {
      return NextResponse.json(
        { error: 'Album not found' },
        { status: 404 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const originalSizeBytes = buffer.length
    const fileHash = getFileHash(buffer)

    if (!isCover) {
      const duplicatePhoto = await findDuplicatePhoto({
        albumId,
        userId: user.id,
        fileHash,
      })

      if (duplicatePhoto) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          photoId: duplicatePhoto.id,
          publicUrl:
            duplicatePhoto.preview_url ||
            duplicatePhoto.public_url ||
            duplicatePhoto.original_url,
          thumbnailUrl: duplicatePhoto.thumbnail_url,
          processingStatus:
            duplicatePhoto.processing_status || 'done',
          message: 'Duplicate photo skipped.',
        })
      }

      const { usedBytes, limitBytes } =
        await getStorageUsageAndLimit(user.id)

      const estimatedPreviewBytes = Math.round(
        originalSizeBytes * 0.35
      )

      const estimatedThumbnailBytes = Math.round(
        originalSizeBytes * 0.05
      )

      const estimatedTotal =
        originalSizeBytes +
        estimatedPreviewBytes +
        estimatedThumbnailBytes

      if (usedBytes + estimatedTotal > limitBytes) {
        return NextResponse.json(
          {
            error: 'Storage full. Please upgrade your plan.',
            usedBytes,
            limitBytes,
            estimatedUploadBytes: estimatedTotal,
          },
          { status: 400 }
        )
      }
    }

    const fileName = getSafeFileName(file.name)

    const storagePath = isCover
      ? `${user.id}/${albumId}/cover/${fileName}`
      : `${user.id}/${albumId}/original/${fileName}`

    uploadedStoragePath = storagePath

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      )
    }

    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath)

    const publicUrl = publicUrlData.publicUrl

    if (isCover) {
      const { error: coverError } = await supabase
        .from('albums')
        .update({
          cover_url: publicUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', albumId)
        .or(`owner_id.eq.${user.id},user_id.eq.${user.id}`)

      if (coverError) {
        return NextResponse.json(
          { error: coverError.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        coverUrl: publicUrl,
      })
    }

    let presetPath: string | null = null
    let presetUploadError: string | null = null

    if (
      presetFile &&
      presetFile.name.toLowerCase().endsWith('.xmp')
    ) {
      const presetBuffer = Buffer.from(
        await presetFile.arrayBuffer()
      )

      const presetName = getSafePresetName(presetFile.name)

      presetPath = `${user.id}/${albumId}/presets/${presetName}`

      const { error: presetError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(presetPath, presetBuffer, {
          contentType: 'application/octet-stream',
          upsert: true,
        })

      if (presetError) {
        presetUploadError = presetError.message
        presetPath = null

        console.error(
          'Preset upload error:',
          presetError.message
        )
      }
    }

    const { data: insertedPhoto, error: insertError } =
      await supabase
        .from('photos')
        .insert({
          album_id: albumId,

          owner_id: user.id,
          user_id: user.id,

          filename: file.name,
          file_name: file.name,

          storage_path: storagePath,
          original_path: storagePath,

          public_url: publicUrl,
          original_url: publicUrl,
          image_url: publicUrl,

          category_id: categoryId,

          file_hash: fileHash,

          file_size_bytes: originalSizeBytes,
          original_size_bytes: originalSizeBytes,
          preview_size_bytes: 0,
          thumbnail_size_bytes: 0,

          mime_type: file.type || 'image/jpeg',

          processing_status: 'pending',
          processing_progress: 0,

          metadata: {
            originalName: file.name,
            uploadedVia: 'api/photos/upload',
            requestedSize: size,
          },
        })
        .select('id, public_url, original_url')
        .single()

    if (insertError) {
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath])

      uploadedStoragePath = null

      if (
        insertError.message
          .toLowerCase()
          .includes('duplicate') ||
        insertError.code === '23505'
      ) {
        const duplicatePhoto = await findDuplicatePhoto({
          albumId,
          userId: user.id,
          fileHash,
        })

        return NextResponse.json({
          success: true,
          duplicate: true,
          photoId: duplicatePhoto?.id ?? null,
          publicUrl:
            duplicatePhoto?.preview_url ||
            duplicatePhoto?.public_url ||
            duplicatePhoto?.original_url ||
            publicUrl,
          processingStatus:
            duplicatePhoto?.processing_status || 'pending',
          message: 'Duplicate photo skipped.',
        })
      }

      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }

    if (!album.cover_url && insertedPhoto?.public_url) {
      await supabase
        .from('albums')
        .update({
          cover_url: insertedPhoto.public_url,
          cover_photo_id: insertedPhoto.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', albumId)
        .or(`owner_id.eq.${user.id},user_id.eq.${user.id}`)
    }

    let jobQueued = false
    let jobError: string | null = null

    if (insertedPhoto?.id) {
      const supabaseAdmin = getSupabaseAdmin()

      if (!supabaseAdmin) {
        jobError = 'Missing SUPABASE_SERVICE_ROLE_KEY'
        console.error(jobError)
      } else {
        const { error: queueError } = await supabaseAdmin
          .from('photo_jobs')
          .insert({
            photo_id: insertedPhoto.id,
            owner_id: user.id,
            album_id: albumId,
            original_path: storagePath,
            size,
            preset_path: presetPath,
            status: 'pending',
            priority: 100,
            progress: 0,
            payload: {
              fileHash,
              originalName: file.name,
              publicUrl,
              requestedSize: size,
            },
          })

        if (queueError) {
          jobError = queueError.message

          console.error(
            'Insert photo_jobs error:',
            queueError.message
          )
        } else {
          jobQueued = true
        }
      }
    }

    const supabaseAdmin = getSupabaseAdmin()

    if (supabaseAdmin) {
      await supabaseAdmin.rpc('recalculate_user_storage', {
        user_uuid: user.id,
      })
    }

    return NextResponse.json({
      success: true,
      duplicate: false,
      publicUrl,
      photoId: insertedPhoto?.id ?? null,
      originalSizeBytes,
      fileHash,
      presetQueued: Boolean(presetPath),
      presetUploadError,
      processingStatus: jobQueued
        ? 'pending'
        : 'original_uploaded',
      jobQueued,
      jobError,
      message: jobQueued
        ? 'Upload completed. Photo queued for Railway worker.'
        : 'Upload completed. Photo saved without worker job.',
    })
  } catch (error) {
    console.error('Stable upload route error:', error)

    if (uploadedStoragePath) {
      try {
        const supabase = await createServerSupabaseClient()

        await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([uploadedStoragePath])
      } catch (cleanupError) {
        console.error(
          'Upload cleanup failed:',
          cleanupError
        )
      }
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Upload failed',
      },
      { status: 500 }
    )
  }
}