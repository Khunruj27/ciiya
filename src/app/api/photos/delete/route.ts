import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  activateStorageDeletionOperation,
  buildPhotoDeletionTargets,
  discardStagedStorageDeletionOperation,
  processStorageDeletionJobs,
  stageStorageDeletionJobs,
} from '@/lib/storage/deletion-jobs'

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

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const supabaseAdmin = getSupabaseAdmin()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (authError) {
      console.error('[photos/delete] authentication failed:', authError.message)
      return NextResponse.json(
        { error: 'Unable to verify authentication' },
        { status: 500 }
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
      return NextResponse.json({ error: 'Invalid photoId' }, { status: 400 })
    }

    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select(
        `
          id,
          album_id,
          owner_id,
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
      .eq('id', photoId)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (photoError) {
      console.error('[photos/delete] photo lookup failed:', photoError.message)
      return NextResponse.json(
        { error: 'Unable to verify photo' },
        { status: 500 }
      )
    }

    if (!photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    let deletionTargets: ReturnType<typeof buildPhotoDeletionTargets>

    try {
      deletionTargets = buildPhotoDeletionTargets({
        photo,
        ownerId: user.id,
        albumId: photo.album_id,
      })
    } catch (pathError) {
      console.error('[photos/delete] invalid storage data:', pathError)
      return NextResponse.json(
        { error: 'Photo storage data is invalid' },
        { status: 409 }
      )
    }

    const staged = await stageStorageDeletionJobs({
      supabase: supabaseAdmin,
      ownerId: user.id,
      albumId: photo.album_id,
      targets: deletionTargets,
    })

    const { error: rpcError } = await supabaseAdmin.rpc(
      'delete_photo_complete',
      {
        target_photo_id: photoId,
        target_owner_id: user.id,
      }
    )

    if (rpcError) {
      console.error('[photos/delete] database deletion failed:', rpcError.message)

      if (staged.operationId) {
        await discardStagedStorageDeletionOperation(
          supabaseAdmin,
          staged.operationId
        )
      }

      return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
    }

    let deletionResult = { claimed: 0, completed: 0, failed: 0 }
    let storageErrorMessage: string | null = null

    if (staged.operationId) {
      try {
        await activateStorageDeletionOperation(
          supabaseAdmin,
          staged.operationId
        )
        deletionResult = await processStorageDeletionJobs({
          supabase: supabaseAdmin,
          workerId: `photo-delete-${randomUUID()}`,
          operationId: staged.operationId,
          limit: Math.max(1, staged.staged),
        })

        const pendingCount = staged.staged - deletionResult.completed
        if (pendingCount > 0) {
          storageErrorMessage = `${pendingCount} object(s) queued for retry`
        }
      } catch (storageError) {
        storageErrorMessage =
          storageError instanceof Error
            ? storageError.message
            : 'Storage deletion queued for retry'
        console.error('[photos/delete] storage cleanup deferred:', storageError)
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
        '[photos/delete] storage recalculation failed:',
        recalculateError.message
      )
    }

    return NextResponse.json({
      success: true,
      deletedFiles: deletionResult.completed,
      cleanupPending:
        staged.staged > deletionResult.completed ||
        Boolean(storageErrorMessage),
      storageWarning: storageErrorMessage,
    })
  } catch (error) {
    console.error('[photos/delete] failed:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
