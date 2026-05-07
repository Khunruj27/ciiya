import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function isAuthorized(req: NextRequest) {
  const workerSecret = process.env.WORKER_SECRET

  if (!workerSecret) {
    return process.env.NODE_ENV !== 'production'
  }

  const authHeader = req.headers.get('authorization')
  const cronSecret = req.headers.get('x-worker-secret')

  return (
    authHeader === `Bearer ${workerSecret}` ||
    cronSecret === workerSecret
  )
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const supabase = getSupabaseAdmin()

    const cleanupBefore = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString()

    const { data: failedPhotos, error } = await supabase
      .from('photos')
      .select(`
        id,
        storage_path,
        preview_path,
        thumbnail_path,
        processing_status
      `)
      .eq('processing_status', 'failed')
      .lt('created_at', cleanupBefore)

    if (error) {
      throw new Error(error.message)
    }

    let deletedFiles = 0
    let deletedPhotos = 0

    for (const photo of failedPhotos || []) {
      const paths = [
        photo.storage_path,
        photo.preview_path,
        photo.thumbnail_path,
      ].filter(Boolean)

      if (paths.length > 0) {
        const { error: storageError } =
          await supabase.storage
            .from('albums')
            .remove(paths)

        if (!storageError) {
          deletedFiles += paths.length
        }
      }

      await supabase
        .from('photo_jobs')
        .delete()
        .eq('photo_id', photo.id)

      await supabase
        .from('photos')
        .delete()
        .eq('id', photo.id)

      deletedPhotos++
    }

    const oldJobDate = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString()

    await supabase
      .from('photo_jobs')
      .delete()
      .eq('status', 'failed')
      .lt('finished_at', oldJobDate)

    const oldLogsDate = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString()

    await supabase
      .from('worker_logs')
      .delete()
      .lt('created_at', oldLogsDate)

    return NextResponse.json({
      success: true,
      deletedPhotos,
      deletedFiles,
      message: 'Cleanup completed',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Cleanup failed',
      },
      { status: 500 }
    )
  }
}