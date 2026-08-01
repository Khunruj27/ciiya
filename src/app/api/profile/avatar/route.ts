import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STORAGE_BUCKET = 'albums'
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

type AllowedAvatarMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'

function getSafeAvatarMimeType(
  value: unknown
): AllowedAvatarMimeType | null {
  const normalizedValue = String(value || '')
    .trim()
    .toLowerCase()

  if (
    normalizedValue === 'image/jpeg' ||
    normalizedValue === 'image/png' ||
    normalizedValue === 'image/webp'
  ) {
    return normalizedValue
  }

  return null
}

function hasValidImageSignature(
  buffer: Buffer,
  mimeType: AllowedAvatarMimeType
) {
  if (mimeType === 'image/jpeg') {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    )
  }

  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    )
  }

  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
}

function getAvatarExtension(
  mimeType: AllowedAvatarMimeType
) {
  if (mimeType === 'image/png') {
    return 'png'
  }

  if (mimeType === 'image/webp') {
    return 'webp'
  }

  return 'jpg'
}

export async function POST(req: NextRequest) {
  let avatarBuffer: Buffer | null = null
  let uploadedPath: string | null = null

  try {
    const supabase =
      await createServerSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      console.error(
        '[profile/avatar] authentication failed:',
        authError.message
      )

      return NextResponse.json(
        { error: 'Unable to verify authentication' },
        { status: 500 }
      )
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const formData =
      await req.formData().catch(() => null)

    if (!formData) {
      return NextResponse.json(
        { error: 'Invalid upload request' },
        { status: 400 }
      )
    }

    const fileValue = formData.get('file')

    const file =
      fileValue instanceof File
        ? fileValue
        : null

    if (!file) {
      return NextResponse.json(
        { error: 'Missing file' },
        { status: 400 }
      )
    }

    if (
      file.name.length > 255 ||
      file.size <= 0 ||
      file.size > MAX_AVATAR_BYTES
    ) {
      return NextResponse.json(
        {
          error:
            file.size > MAX_AVATAR_BYTES
              ? 'Avatar file is too large. Maximum 5MB allowed.'
              : 'Invalid avatar file',
        },
        { status: 400 }
      )
    }

    const mimeType =
      getSafeAvatarMimeType(file.type)

    if (!mimeType) {
      return NextResponse.json(
        {
          error:
            'Only JPEG, PNG and WEBP images are allowed',
        },
        { status: 400 }
      )
    }

    avatarBuffer = Buffer.from(
      await file.arrayBuffer()
    )

    if (
      avatarBuffer.length !== file.size ||
      !hasValidImageSignature(
        avatarBuffer,
        mimeType
      )
    ) {
      return NextResponse.json(
        { error: 'Invalid or corrupted image file' },
        { status: 400 }
      )
    }

    const extension =
      getAvatarExtension(mimeType)

    const fileName =
      `avatar-${Date.now()}.${extension}`

    const path =
      `${user.id}/profile/${fileName}`

    uploadedPath = path

    const { error: uploadError } =
      await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, avatarBuffer, {
          contentType: mimeType,
          cacheControl: '31536000',
          upsert: false,
        })

    if (uploadError) {
      console.error(
        '[profile/avatar] storage upload failed:',
        uploadError.message
      )

      return NextResponse.json(
        { error: 'Unable to upload avatar' },
        { status: 500 }
      )
    }

    const { data: publicUrlData } =
      supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(path)

    const avatarUrl =
      publicUrlData.publicUrl

    const { error: updateUserError } =
      await supabase.auth.updateUser({
        data: {
          avatar_url: avatarUrl,
        },
      })

    if (updateUserError) {
      console.error(
        '[profile/avatar] user metadata update failed:',
        updateUserError.message
      )

      const { error: cleanupError } =
        await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([path])

      if (cleanupError) {
        console.error(
          '[profile/avatar] upload rollback failed:',
          cleanupError.message
        )
      } else {
        uploadedPath = null
      }

      return NextResponse.json(
        { error: 'Unable to update avatar' },
        { status: 500 }
      )
    }

    uploadedPath = null

    return NextResponse.json({
      success: true,
      avatarUrl,
    })
  } catch (error) {
    console.error(
      '[profile/avatar] unexpected error:',
      error
    )

    if (uploadedPath) {
      try {
        const supabase =
          await createServerSupabaseClient()

        const { error: cleanupError } =
          await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([uploadedPath])

        if (cleanupError) {
          console.error(
            '[profile/avatar] cleanup failed:',
            cleanupError.message
          )
        }
      } catch (cleanupError) {
        console.error(
          '[profile/avatar] cleanup failed:',
          cleanupError
        )
      }
    }

    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    )
  } finally {
    avatarBuffer?.fill(0)
    avatarBuffer = null
  }
}