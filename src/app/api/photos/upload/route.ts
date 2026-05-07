import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

async function getStorageUsageAndLimit(userId: string) {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('photos')
    .select(`
      original_size_bytes,
      preview_size_bytes,
      thumbnail_size_bytes
    `)
    .eq('owner_id', userId)

  if (error) {
    throw new Error(error.message)
  }

  const usedBytes = (data ?? []).reduce((sum, row) => {
    return (
      sum +
      Number(row.original_size_bytes || 0) +
      Number(row.preview_size_bytes || 0) +
      Number(row.thumbnail_size_bytes || 0)
    )
  }, 0)

  const { storageLimitBytes } = await getUserStoragePlan(userId)

  return {
    usedBytes,
    limitBytes: Number(storageLimitBytes || 5 * 1024 * 1024 * 1024),
  }
}

function getSafeFileName(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg'

  const baseName = fileName.replace(/\.[^/.]+$/, '')

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

  return `${Date.now()}-${safeBaseName || 'photo'}.${ext}`
}

function getSafePresetName(fileName: string) {
  const baseName = fileName.replace(/\.[^/.]+$/, '')

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

  return `${Date.now()}-${safeBaseName || 'preset'}.xmp`
}

async function triggerWorker(req: NextRequest) {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      req.nextUrl.origin

    const workerSecret =
      process.env.WORKER_SECRET || ''

    const controller = new AbortController()

    const timeout = setTimeout(() => {
      controller.abort()
    }, 4000)

    const response = await fetch(
      `${baseUrl}/api/worker/process-photos?limit=3`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${workerSecret}`,
        },
        cache: 'no-store',
        signal: controller.signal,
      }
    )

    clearTimeout(timeout)

    if (!response.ok) {
      console.error(
        'Worker trigger failed:',
        response.status
      )
    }
  } catch (error) {
    console.error(
      'Auto trigger worker failed:',
      error
    )
  }
}

export async function POST(req: NextRequest) {
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

    const albumId = String(
      formData.get('albumId') || ''
    ).trim()

    const size = String(
      formData.get('size') || 'original'
    )
      .trim()
      .toLowerCase()

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

    const maxUploadBytes = 100 * 1024 * 1024

    if (file.size > maxUploadBytes) {
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

    const { data: album, error: albumError } =
      await supabase
        .from('albums')
        .select('id, owner_id, cover_url')
        .eq('id', albumId)
        .eq('owner_id', user.id)
        .single()

    if (albumError || !album) {
      return NextResponse.json(
        { error: 'Album not found' },
        { status: 404 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    const originalSizeBytes = buffer.length

    if (!isCover) {
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
            error:
              'Storage full. Please upgrade your plan.',
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

    const { error: uploadError } = await supabase.storage
      .from('albums')
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
      .from('albums')
      .getPublicUrl(storagePath)

    const publicUrl = publicUrlData.publicUrl

    if (isCover) {
      const { error: coverError } = await supabase
        .from('albums')
        .update({
          cover_url: publicUrl,
        })
        .eq('id', albumId)
        .eq('owner_id', user.id)

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

      const presetName = getSafePresetName(
        presetFile.name
      )

      presetPath = `${user.id}/${albumId}/presets/${presetName}`

      const { error: presetError } =
        await supabase.storage
          .from('albums')
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
          filename: file.name,
          storage_path: storagePath,
          public_url: publicUrl,
          category_id: categoryId,

          file_size_bytes: originalSizeBytes,

          original_size_bytes: originalSizeBytes,
          preview_size_bytes: 0,
          thumbnail_size_bytes: 0,

          processing_status: 'pending',
          processing_progress: 0,

          original_path: storagePath,
        })
        .select('id, public_url')
        .single()

    if (insertError) {
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
        })
        .eq('id', albumId)
        .eq('owner_id', user.id)
    }

    let jobQueued = false
    let jobError: string | null = null

    if (insertedPhoto?.id) {
      const supabaseAdmin = getSupabaseAdmin()

      if (!supabaseAdmin) {
        jobError =
          'Missing SUPABASE_SERVICE_ROLE_KEY'

        console.error(jobError)
      } else {
        const { error: queueError } =
          await supabaseAdmin
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
            })

        if (queueError) {
          jobError = queueError.message

          console.error(
            'Insert photo_jobs error:',
            queueError.message
          )
        } else {
          jobQueued = true

          console.log(
            'Photo processing job queued:',
            insertedPhoto.id
          )

          triggerWorker(req).catch((error) => {
            console.error(
              'Background worker trigger failed:',
              error
            )
          })
        }
      }
    }

    return NextResponse.json({
      success: true,
      publicUrl,
      photoId: insertedPhoto?.id ?? null,
      originalSizeBytes,
      presetQueued: Boolean(presetPath),
      presetUploadError,
      processingStatus: jobQueued
        ? 'pending'
        : 'original_uploaded',
      jobQueued,
      jobError,
    })
  } catch (error) {
    console.error(
      'Fast upload route error:',
      error
    )

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