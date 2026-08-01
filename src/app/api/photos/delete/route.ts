import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase admin env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

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

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const supabaseAdmin = getSupabaseAdmin()

   const {
  data: { user },
  error: authError,
} = await supabase.auth.getUser()

if (authError) {
  console.error(
    '[photos/delete] authentication failed:',
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

    const body = await req.json().catch(() => null)

if (!body) {
  return NextResponse.json(
    { error: 'Invalid request body' },
    { status: 400 }
  )
}

const photoId = String(body.photoId || '').trim()

if (!photoId) {
  return NextResponse.json(
    { error: 'photoId is required' },
    { status: 400 }
  )
}

if (photoId.length > 100) {
  return NextResponse.json(
    { error: 'Invalid photoId' },
    { status: 400 }
  )
}

    const {
  data: photo,
  error: photoError,
} = await supabase
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
  .maybeSingle()

if (photoError) {
  console.error(
    '[photos/delete] photo lookup failed:',
    photoError.message
  )

  return NextResponse.json(
    { error: 'Unable to verify photo' },
    { status: 500 }
  )
}

if (!photo) {
  return NextResponse.json(
    { error: 'Photo not found' },
    { status: 404 }
  )
}

const albumPrefix = `${user.id}/${photo.album_id}/`

const allowedPhotoPrefixes = [
  `${albumPrefix}original/`,
  `${albumPrefix}preview/`,
  `${albumPrefix}thumbnail/`,
  `${albumPrefix}thumbnails/`,
  `${albumPrefix}sd/`,
  `${albumPrefix}hd/`,
  `${albumPrefix}uhd/`,
]

const candidatePaths = uniquePaths([
  photo.storage_path,
  photo.original_path,
  photo.preview_path,
  photo.thumbnail_path,
  photo.sd_path,
  photo.hd_path,
  photo.uhd_path,
])

const invalidPath = candidatePaths.find(
  (path) =>
    hasUnsafeStoragePath(path) ||
    !allowedPhotoPrefixes.some((prefix) =>
      path.startsWith(prefix)
    )
)

if (invalidPath) {
  console.error(
    '[photos/delete] invalid storage path detected:',
    {
      photoId: photo.id,
      albumId: photo.album_id,
    }
  )

  return NextResponse.json(
    { error: 'Photo storage data is invalid' },
    { status: 409 }
  )
}

const pathsToRemove = candidatePaths

   let storageErrorMessage: string | null = null
   let deletedFilesCount = 0

    const { error: rpcError } = await supabaseAdmin.rpc(
  'delete_photo_complete',
  {
    target_photo_id: photoId,
    target_owner_id: user.id,
  }
)

if (rpcError) {
  console.error('Delete photo RPC error:', rpcError.message)

  return NextResponse.json(
    { error: 'Delete failed' },
    { status: 500 }
  )
}

 if (pathsToRemove.length > 0) {
  const { error: storageError } =
    await supabaseAdmin.storage
      .from('albums')
      .remove(pathsToRemove)

  if (storageError) {
    storageErrorMessage = storageError.message

    console.error(
      'Delete photo storage error:',
      storageError.message
    )
  } else {
    deletedFilesCount = pathsToRemove.length
  }
}

 const { error: recalculateError } =
  await supabaseAdmin.rpc(
    'recalculate_user_storage',
    {
      user_uuid: user.id,
    }
  )

if (recalculateError) {
  console.error(
    'Recalculate storage after photo delete failed:',
    recalculateError.message
  )
}

    return NextResponse.json({
      success: true,
      deletedFiles: deletedFilesCount,
      storageWarning: storageErrorMessage,
    })
 } catch (error) {
  console.error('Delete photo error:', error)

  return NextResponse.json(
    { error: 'Delete failed' },
    { status: 500 }
  )
}
}