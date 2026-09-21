import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  activateStorageDeletionOperation,
  buildAlbumObjectDeletionTarget,
  buildLegacyGuestMomentDeletionTarget,
  buildPhotoDeletionTargets,
  dedupeStorageDeletionTargets,
  processStorageDeletionJobs,
  stageStorageDeletionJobs,
  type StorageDeletionTarget,
} from '@/lib/storage/deletion-jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIST_LIMIT = 1000

type StorageFile = {
  name: string
}

type SupabaseAdminClient = SupabaseClient

function getSupabaseAdmin(): SupabaseAdminClient {
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

async function listAllStoragePaths(
  supabase: SupabaseAdminClient,
  bucket: string,
  prefix: string
) {
  const allPaths: string[] = []
  let offset = 0

  while (true) {
    const { data: files, error } = await supabase.storage
      .from(bucket)
      .list(prefix, {
        limit: LIST_LIMIT,
        offset,
        sortBy: {
          column: 'name',
          order: 'asc',
        },
      })

    if (error) {
      throw new Error(
        `Unable to list ${bucket}/${prefix}: ${error.message}`
      )
    }

    const storageFiles = (files || []) as StorageFile[]

    if (storageFiles.length === 0) break

    allPaths.push(
      ...storageFiles
        .filter((file) => file.name)
        .map((file) => `${prefix}/${file.name}`)
    )

    if (storageFiles.length < LIST_LIMIT) break

    offset += LIST_LIMIT
  }

  return allPaths
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const supabaseAdmin = getSupabaseAdmin()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)

    if (!body) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const albumId = String(body.albumId || '').trim()

    if (!albumId) {
      return NextResponse.json(
        { error: 'albumId is required' },
        { status: 400 }
      )
    }

    if (albumId.length > 100) {
      return NextResponse.json(
        { error: 'Invalid albumId' },
        { status: 400 }
      )
    }

    const { data: album, error: albumCheckError } = await supabase
      .from('albums')
      .select('id, owner_id')
      .eq('id', albumId)
      .eq('owner_id', user.id)
      .single()

    if (albumCheckError || !album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    const { data: photosData, error: photoError } = await supabase
      .from('photos')
      .select(
        `
        id,
        album_id,
        storage_provider,
        storage_bucket,
        storage_path,
        original_path,
        preview_path,
        thumbnail_path,
        sd_path,
        hd_path,
        uhd_path
      `
      )
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    if (photoError) {
      return NextResponse.json({ error: photoError.message }, { status: 500 })
    }

    const photos = photosData ?? []
    const photoIds = photos.map((photo) => photo.id)

    const expectedPrefix = `${user.id}/${albumId}/`

    const folderPrefixes = [
      `${expectedPrefix}cover`,
      `${expectedPrefix}photos`,
      `${expectedPrefix}original`,
      `${expectedPrefix}preview`,
      `${expectedPrefix}thumbnail`,
      `${expectedPrefix}thumbnails`,
      `${expectedPrefix}sd`,
      `${expectedPrefix}hd`,
      `${expectedPrefix}uhd`,
      `${expectedPrefix}presets`,
    ].filter((prefix) => prefix.startsWith(expectedPrefix))

    const deletionTargets: StorageDeletionTarget[] = []

    try {
      for (const photo of photos) {
        deletionTargets.push(
          ...buildPhotoDeletionTargets({
            photo,
            ownerId: user.id,
            albumId,
          })
        )
      }
    } catch (pathError) {
      console.error('[albums/delete] invalid photo storage data:', pathError)
      return NextResponse.json(
        { error: 'Album storage data is invalid' },
        { status: 409 }
      )
    }

    const { data: storageAssets, error: storageAssetError } =
      await supabaseAdmin
        .from('storage_assets')
        .select('storage_provider, storage_bucket, object_key')
        .eq('owner_id', user.id)
        .eq('album_id', albumId)

    if (storageAssetError) {
      return NextResponse.json(
        { error: storageAssetError.message },
        { status: 500 }
      )
    }

    try {
      for (const asset of storageAssets || []) {
        const provider = asset.storage_provider

        if (provider !== 'supabase' && provider !== 'r2') {
          throw new Error('Unsupported storage asset provider')
        }

        deletionTargets.push(
          buildAlbumObjectDeletionTarget({
            provider,
            bucket: asset.storage_bucket,
            key: asset.object_key,
            ownerId: user.id,
            albumId,
          })
        )
      }
    } catch (pathError) {
      console.error('[albums/delete] invalid non-photo storage data:', pathError)
      return NextResponse.json(
        { error: 'Album asset storage data is invalid' },
        { status: 409 }
      )
    }

    const { data: guestMoments, error: guestMomentError } =
      await supabaseAdmin
        .from('guest_moments')
        .select('storage_paths')
        .eq('album_id', albumId)

    if (guestMomentError) {
      return NextResponse.json(
        { error: guestMomentError.message },
        { status: 500 }
      )
    }

    for (const moment of guestMoments || []) {
      for (const path of moment.storage_paths || []) {
        // New owner-scoped objects are already represented by storage_assets.
        // Only the pre-Phase-10 albumId/date path needs this compatibility row.
        if (String(path).startsWith(expectedPrefix)) continue

        try {
          deletionTargets.push(
            buildLegacyGuestMomentDeletionTarget({
              key: String(path),
              albumId,
            })
          )
        } catch (pathError) {
          console.error(
            '[albums/delete] ignored unsafe legacy Guest Moment path:',
            pathError
          )
        }
      }
    }

    for (const prefix of folderPrefixes) {
      const paths = await listAllStoragePaths(supabaseAdmin, 'albums', prefix)

      for (const path of paths) {
        try {
          deletionTargets.push(
            buildAlbumObjectDeletionTarget({
              provider: 'supabase',
              bucket: 'albums',
              key: path,
              ownerId: user.id,
              albumId,
            })
          )
        } catch (pathError) {
          console.error('[albums/delete] ignored unsafe listed path:', pathError)
        }
      }
    }

    const legacyOriginalPaths = await listAllStoragePaths(
      supabaseAdmin,
      'originals',
      `${expectedPrefix}original`
    )

    for (const path of legacyOriginalPaths) {
      try {
        deletionTargets.push(
          buildAlbumObjectDeletionTarget({
            provider: 'supabase',
            bucket: 'originals',
            key: path,
            ownerId: user.id,
            albumId,
          })
        )
      } catch (pathError) {
        console.error('[albums/delete] ignored unsafe original path:', pathError)
      }
    }

    const staged = await stageStorageDeletionJobs({
      supabase: supabaseAdmin,
      ownerId: user.id,
      albumId,
      targets: dedupeStorageDeletionTargets(deletionTargets),
    })

    if (photoIds.length > 0) {
      await supabaseAdmin.from('worker_logs').delete().in('photo_id', photoIds)
    }

    await supabaseAdmin
      .from('worker_logs')
      .delete()
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    const { error: deleteCameraImportFilesError } = await supabaseAdmin
      .from('camera_import_files')
      .delete()
      .eq('album_id', albumId)

    if (deleteCameraImportFilesError) {
      return NextResponse.json(
        {
          error: `camera_import_files: ${deleteCameraImportFilesError.message}`,
        },
        { status: 500 }
      )
    }

    const { error: deleteCameraImportJobsError } = await supabaseAdmin
      .from('camera_import_jobs')
      .delete()
      .eq('album_id', albumId)

    if (deleteCameraImportJobsError) {
      return NextResponse.json(
        {
          error: `camera_import_jobs: ${deleteCameraImportJobsError.message}`,
        },
        { status: 500 }
      )
    }

    const { error: deleteCameraLiveImportsError } = await supabaseAdmin
      .from('camera_live_imports')
      .delete()
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    if (deleteCameraLiveImportsError) {
      return NextResponse.json(
        {
          error: `camera_live_imports: ${deleteCameraLiveImportsError.message}`,
        },
        { status: 500 }
      )
    }

    const { error: deleteCameraSessionsError } = await supabaseAdmin
      .from('camera_sessions')
      .delete()
      .eq('album_id', albumId)
      .eq('user_id', user.id)

    if (deleteCameraSessionsError) {
      return NextResponse.json(
        {
          error: `camera_sessions: ${deleteCameraSessionsError.message}`,
        },
        { status: 500 }
      )
    }

    const { error: deleteCameraUploadSessionsError } = await supabaseAdmin
      .from('camera_upload_sessions')
      .delete()
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    if (deleteCameraUploadSessionsError) {
      return NextResponse.json(
        {
          error: `camera_upload_sessions: ${deleteCameraUploadSessionsError.message}`,
        },
        { status: 500 }
      )
    }

    const { error: deleteJobsByAlbumError } = await supabaseAdmin
      .from('photo_jobs')
      .delete()
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    if (deleteJobsByAlbumError) {
  console.error(
    '[albums/delete] delete photo jobs by album failed:',
    deleteJobsByAlbumError.message
  )

  return NextResponse.json(
    { error: 'Delete album failed' },
    { status: 500 }
  )
}

    if (photoIds.length > 0) {
      const { error: deleteJobsByPhotoError } = await supabaseAdmin
        .from('photo_jobs')
        .delete()
        .in('photo_id', photoIds)

      if (deleteJobsByPhotoError) {
        return NextResponse.json(
          { error: deleteJobsByPhotoError.message },
          { status: 500 }
        )
      }
    }

    const { error: deleteFaceJobsByAlbumError } = await supabaseAdmin
      .from('face_jobs')
      .delete()
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    if (deleteFaceJobsByAlbumError) {
  console.error(deleteFaceJobsByAlbumError.message)

  return NextResponse.json(
    { error: 'Delete album failed' },
    { status: 500 }
  )
}

    if (photoIds.length > 0) {
      const { error: deleteFaceJobsByPhotoError } = await supabaseAdmin
        .from('face_jobs')
        .delete()
        .in('photo_id', photoIds)

      if (deleteFaceJobsByPhotoError) {
        return NextResponse.json(
          { error: deleteFaceJobsByPhotoError.message },
          { status: 500 }
        )
      }

      const { error: deletePhotoFacesError } = await supabaseAdmin
        .from('photo_faces')
        .delete()
        .in('photo_id', photoIds)

      if (deletePhotoFacesError) {
        return NextResponse.json(
          { error: deletePhotoFacesError.message },
          { status: 500 }
        )
      }
    }

    const { error: deleteFaceClustersError } = await supabaseAdmin
      .from('face_clusters')
      .delete()
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    if (deleteFaceClustersError) {
      return NextResponse.json(
        { error: deleteFaceClustersError.message },
        { status: 500 }
      )
    }

    const { error: deletePhotosError } = await supabaseAdmin
      .from('photos')
      .delete()
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    if (deletePhotosError) {
      return NextResponse.json(
        { error: deletePhotosError.message },
        { status: 500 }
      )
    }

    const { error: albumError } = await supabaseAdmin
      .from('albums')
      .delete()
      .eq('id', albumId)
      .eq('owner_id', user.id)

    if (albumError) {
      return NextResponse.json({ error: albumError.message }, { status: 500 })
    }

    let deletionResult = { claimed: 0, completed: 0, failed: 0 }
    let storageWarning: string | null = null

    if (staged.operationId) {
      try {
        await activateStorageDeletionOperation(
          supabaseAdmin,
          staged.operationId
        )
        deletionResult = await processStorageDeletionJobs({
          supabase: supabaseAdmin,
          workerId: `album-delete-${randomUUID()}`,
          operationId: staged.operationId,
          limit: Math.max(1, staged.staged),
        })

        const pendingCount = staged.staged - deletionResult.completed
        if (pendingCount > 0) {
          storageWarning = `${pendingCount} object(s) queued for retry`
        }
      } catch (storageError) {
        storageWarning =
          storageError instanceof Error
            ? storageError.message
            : 'Storage deletion queued for retry'
        console.error('[albums/delete] storage cleanup deferred:', storageError)
      }
    }

    const { error: recalculateError } = await supabaseAdmin.rpc(
      'recalculate_user_storage',
      {
        user_uuid: user.id,
      }
    )

    if (recalculateError) {
      console.error(
        'Recalculate storage after album delete failed:',
        recalculateError.message
      )
    }

    return NextResponse.json({
      success: true,
      deletedStorageFiles: deletionResult.completed,
      deletedPhotoRows: photos.length,
      deletedAlbumId: albumId,
      cleanupPending:
        staged.staged > deletionResult.completed ||
        Boolean(storageWarning),
      storageWarning,
      storageRecalculated: !recalculateError,
    })
  } catch (error) {
    console.error('Delete album error:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Delete failed',
      },
      { status: 500 }
    )
  }
}
