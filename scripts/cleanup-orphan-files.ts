import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const BUCKET = 'albums'
const DRY_RUN = process.env.CLEANUP_DRY_RUN !== 'false'
const DELETE_CHUNK_SIZE = Number(process.env.CLEANUP_DELETE_CHUNK_SIZE || 100)
const LIST_LIMIT = Number(process.env.CLEANUP_LIST_LIMIT || 1000)

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

function normalizePath(value: unknown) {
  if (!value || typeof value !== 'string') return null

  const clean = value.trim().replace(/^\/+/, '')

  if (!clean) return null
  if (clean.startsWith('http://') || clean.startsWith('https://')) return null

  return clean
}

function isFolderLike(item: { id?: string | null; metadata?: unknown }) {
  return !item.id
}

async function getAllPhotoPaths() {
  const { data, error } = await supabase.from('photos').select(`
      storage_path,
      original_path,
      preview_path,
      thumbnail_path,
      sd_path,
      hd_path,
      uhd_path
    `)

  if (error) {
    throw new Error(error.message)
  }

  const paths = new Set<string>()

  for (const row of data || []) {
    const values = [
      row.storage_path,
      row.original_path,
      row.preview_path,
      row.thumbnail_path,
      row.sd_path,
      row.hd_path,
      row.uhd_path,
    ]

    for (const value of values) {
      const path = normalizePath(value)

      if (path) {
        paths.add(path)
      }
    }
  }

  return paths
}

async function listAllStorageFiles(prefix = '') {
  const allFiles: string[] = []

  async function scan(folder: string) {
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, {
      limit: LIST_LIMIT,
      sortBy: {
        column: 'name',
        order: 'asc',
      },
    })

    if (error) {
      throw new Error(error.message)
    }

    for (const item of data || []) {
      const fullPath = folder ? `${folder}/${item.name}` : item.name

      if (isFolderLike(item)) {
        await scan(fullPath)
      } else {
        allFiles.push(fullPath)
      }
    }
  }

  await scan(prefix)

  return allFiles
}

async function removeInChunks(paths: string[]) {
  let removed = 0
  let failed = 0

  for (let i = 0; i < paths.length; i += DELETE_CHUNK_SIZE) {
    const chunk = paths.slice(i, i + DELETE_CHUNK_SIZE)

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would remove ${chunk.length} file(s)`)
      continue
    }

    const { error } = await supabase.storage.from(BUCKET).remove(chunk)

    if (error) {
      failed += chunk.length
      console.error('[Cleanup] remove failed:', error.message)
    } else {
      removed += chunk.length
      console.log(`[Cleanup] removed ${chunk.length} orphan file(s)`)
    }
  }

  return { removed, failed }
}

async function cleanup() {
  console.log('[Cleanup] scanning database paths...')

  const validPaths = await getAllPhotoPaths()

  console.log('[Cleanup] DB referenced paths:', validPaths.size)

  console.log('[Cleanup] scanning storage files...')

  const storageFiles = await listAllStorageFiles()

  console.log('[Cleanup] Storage files:', storageFiles.length)

  const orphanFiles = storageFiles.filter((file) => !validPaths.has(file))

  console.log('[Cleanup] Orphan files:', orphanFiles.length)

  if (orphanFiles.length > 0) {
    console.log('[Cleanup] First orphan samples:', orphanFiles.slice(0, 20))
  }

  if (orphanFiles.length === 0) {
    console.log('[Cleanup] No orphan files found')
    return
  }

  const result = await removeInChunks(orphanFiles)

  if (DRY_RUN) {
    console.log('[Cleanup] Dry run completed. No files were deleted.')
    console.log('[Cleanup] Set CLEANUP_DRY_RUN=false to delete orphan files.')
    return
  }

  console.log('[Cleanup] Cleanup completed:', result)
}

cleanup()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[Cleanup] fatal:', error)
    process.exit(1)
  })