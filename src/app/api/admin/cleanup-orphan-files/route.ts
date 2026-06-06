import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

type StorageFile = {
  name: string
}

async function listAllFiles(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  path: string
) {
  const allFiles: string[] = []

  async function scan(folder: string) {
    const { data, error } = await supabase.storage
      .from('albums')
      .list(folder, {
        limit: 1000,
      })

    if (error || !data) return

    for (const item of data as StorageFile[]) {
      const fullPath = folder
        ? `${folder}/${item.name}`
        : item.name

      if (!item.name.includes('.')) {
        await scan(fullPath)
      } else {
        allFiles.push(fullPath)
      }
    }
  }

  await scan(path)

  return allFiles
}

export async function POST() {
  try {
    const supabase = getSupabaseAdmin()

    // =========================
    // GET FILES FROM STORAGE
    // =========================

    const storageFiles = await listAllFiles(supabase, '')

    // =========================
    // GET FILES FROM DB
    // =========================

    const { data: photos, error } = await supabase
      .from('photos')
      .select(`
        storage_path,
        preview_path,
        thumbnail_path,
        original_path,
        sd_path,
        hd_path,
        uhd_path
      `)

    if (error) {
      throw new Error(error.message)
    }

    const validPaths = new Set<string>()

    for (const photo of photos || []) {
      const paths = [
        photo.storage_path,
        photo.preview_path,
        photo.thumbnail_path,
        photo.original_path,
        photo.sd_path,
        photo.hd_path,
        photo.uhd_path,
      ]

      for (const value of paths) {
        if (value && typeof value === 'string') {
          validPaths.add(value)
        }
      }
    }

    // =========================
    // FIND ORPHANS
    // =========================

    const orphanFiles = storageFiles.filter(
      (file) => !validPaths.has(file)
    )

    // =========================
    // DELETE ORPHANS
    // =========================

    let deletedCount = 0

    if (orphanFiles.length > 0) {
      const chunkSize = 100

      for (let i = 0; i < orphanFiles.length; i += chunkSize) {
        const chunk = orphanFiles.slice(i, i + chunkSize)

        const { error: removeError } = await supabase.storage
          .from('albums')
          .remove(chunk)

        if (!removeError) {
          deletedCount += chunk.length
        }
      }
    }

    return NextResponse.json({
      success: true,
      scannedFiles: storageFiles.length,
      orphanFiles: orphanFiles.length,
      deletedFiles: deletedCount,
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Cleanup orphan files failed',
      },
      {
        status: 500,
      }
    )
  }
}