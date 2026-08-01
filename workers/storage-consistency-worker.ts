import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

const configuredPollInterval = Number(
  process.env.STORAGE_CONSISTENCY_INTERVAL || 60_000
)

const POLL_INTERVAL =
  Number.isFinite(configuredPollInterval) && configuredPollInterval >= 1000
    ? configuredPollInterval
    : 60_000

console.log('[StorageConsistencyWorker] started')

let lastCleanupAt = 0
let isShuttingDown = false
const wakeSleepers = new Set<() => void>()

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    let settled = false

    const finish = () => {
      if (settled) return

      settled = true
      clearTimeout(timer)
      wakeSleepers.delete(finish)
      resolve()
    }

    const timer = setTimeout(finish, ms)
    wakeSleepers.add(finish)
  })
}

function requestShutdown(signal: string) {
  if (isShuttingDown) return

  isShuttingDown = true

  console.log(`[StorageConsistencyWorker] received ${signal}, shutting down`)

  for (const wake of [...wakeSleepers]) {
    wake()
  }
}

process.on('SIGTERM', () => requestShutdown('SIGTERM'))
process.on('SIGINT', () => requestShutdown('SIGINT'))

async function logIssue(
  issueType: string,
  ownerId: string,
  albumId: string | null,
  photoId: string | null,
  storagePath: string | null,
  details: Record<string, unknown> = {}
) {
  const { data: existing } = await supabase
    .from('storage_consistency_issues')
    .select('id')
    .eq('issue_type', issueType)
    .eq('status', 'open')
    .eq('storage_path', storagePath)
    .maybeSingle()

  if (existing) return

  const { error } = await supabase
    .from('storage_consistency_issues')
    .insert({
  issue_type: issueType,
  owner_id: ownerId,
  album_id: albumId,
  photo_id: photoId,
  bucket: 'albums',
  storage_path: storagePath,
  severity:
    issueType === 'missing_storage_file' ? 'high' : 'warning',
  status: 'open',
  details,
  detected_at: new Date().toISOString(),
})

  if (error) {
    console.error(error.message)
  }
}

async function resolveIssue(
  issueType: string,
  storagePath: string | null
) {
  if (!storagePath) return

  const { error } = await supabase
    .from('storage_consistency_issues')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    })
    .eq('issue_type', issueType)
    .eq('status', 'open')
    .eq('storage_path', storagePath)

  if (error) {
    console.error('[StorageConsistencyWorker] resolve failed:', error.message)
  }
}

async function storageFileExists(path: string): Promise<boolean | null> {
  const parts = path.split('/')

  if (parts.length < 2) {
    return false
  }

  const filename = parts.pop()

  if (!filename) {
    return false
  }

  const folder = parts.join('/')

  const { data, error } = await supabase.storage
    .from('albums')
    .list(folder, {
      limit: 100,
      search: filename,
    })

  if (error) {
    console.error(
      `[StorageConsistencyWorker] storage lookup failed for ${path}:`,
      error.message
    )

    return null
  }

  return data.some((item) => item.name === filename)
}

async function listStoragePaths(prefix: string) {
  const { data, error } = await supabase.storage
    .from('albums')
    .list(prefix, {
      limit: 1000,
      sortBy: {
        column: 'name',
        order: 'asc',
      },
    })

  if (error) {
    console.error('[StorageConsistencyWorker] list failed:', error.message)
    return []
  }

  return (data || [])
    .filter((item) => item.name)
    .map((item) => `${prefix}/${item.name}`)
}

async function scanPhotos() {
  const { data: photos, error } = await supabase
    .from('photos')
    .select(`
      id,
      album_id,
      owner_id,
      original_path,
      preview_path,
      thumbnail_path,
      hd_path,
      sd_path,
      uhd_path
    `)

  if (error) {
    console.error(error.message)
    return
  }

  for (const photo of photos ?? []) {
    const paths = [
      photo.original_path,
      photo.preview_path,
      photo.thumbnail_path,
      photo.hd_path,
      photo.sd_path,
      photo.uhd_path,
    ].filter(Boolean) as string[]

    for (const storagePath of paths) {
      const exists = await storageFileExists(storagePath)

if (exists === null) {
  continue
}

if (!exists) {

    await logIssue(
    'missing_storage_file',
    photo.owner_id,
    photo.album_id,
    photo.id,
    storagePath,
    {
      source: 'photos',
    }
  )

  if (
  storagePath !== photo.original_path &&
  photo.original_path &&
  photo.owner_id &&
  photo.album_id
) {
  const originalExists = await storageFileExists(photo.original_path)

  if (originalExists === true) {
    await queueRepairJob({
      id: photo.id,
      album_id: photo.album_id,
      owner_id: photo.owner_id,
      original_path: photo.original_path,
    })
  }
}
}

else {
  await resolveIssue('missing_storage_file', storagePath)
}

    }
  }
  
  

  console.log('[StorageConsistencyWorker] photo scan complete')
}



async function start() {
  while (!isShuttingDown) {
    const now = Date.now()

    try {
      await scanPhotos()
      await scanStorageOrphans()
      await resolveMissingOrphanIssues()

      if (now - lastCleanupAt > 24 * 60 * 60 * 1000) {
        await cleanupOldIssues()
        lastCleanupAt = now
      }
    } catch (error) {
      console.error('[StorageConsistencyWorker] scan failed:', error)
    }

    if (isShuttingDown) {
      break
    }

    await sleep(POLL_INTERVAL)
  }

  console.log('[StorageConsistencyWorker] graceful shutdown complete')
}

start().catch((error) => {
  console.error('[StorageConsistencyWorker] fatal:', error)
  process.exit(1)
})

async function scanStorageOrphans() {
  const { data: albums, error: albumError } = await supabase
    .from('albums')
    .select('id, owner_id')

  if (albumError) {
    console.error(albumError.message)
    return
  }

  for (const album of albums ?? []) {
    const ownerId = album.owner_id
    const albumId = album.id

    if (!ownerId || !albumId) continue

    const { data: photos, error: photoError } = await supabase
      .from('photos')
      .select(`
        storage_path,
        original_path,
        preview_path,
        thumbnail_path,
        hd_path,
        sd_path,
        uhd_path
      `)
      .eq('album_id', albumId)
      .eq('owner_id', ownerId)

    if (photoError) {
      console.error(photoError.message)
      continue
    }

    const knownPaths = new Set(
      (photos ?? [])
        .flatMap((photo) => [
          photo.storage_path,
          photo.original_path,
          photo.preview_path,
          photo.thumbnail_path,
          photo.hd_path,
          photo.sd_path,
          photo.uhd_path,
        ])
        .filter(Boolean)
        .map(String)
    )

    const prefixes = [
      `${ownerId}/${albumId}/original`,
      `${ownerId}/${albumId}/preview`,
      `${ownerId}/${albumId}/thumbnail`,
      `${ownerId}/${albumId}/sd`,
      `${ownerId}/${albumId}/hd`,
      `${ownerId}/${albumId}/uhd`,
    ]

    for (const prefix of prefixes) {
      const storagePaths = await listStoragePaths(prefix)

      for (const storagePath of storagePaths) {
        if (knownPaths.has(storagePath)) continue

        await logIssue(
          'storage_orphan_file',
          ownerId,
          albumId,
          null,
          storagePath,
          {
            source: 'storage',
            prefix,
          }
        )
      }
    }
  }

  console.log('[StorageConsistencyWorker] orphan scan complete')
}

async function queueRepairJob(photo: {
  id: string
  album_id: string
  owner_id: string
  original_path: string
}) {
  const { data: existing } = await supabase
    .from('photo_jobs')
    .select('id')
    .eq('photo_id', photo.id)
    .in('status', ['pending', 'processing'])
    .maybeSingle()

  if (existing) return

  const { error } = await supabase
    .from('photo_jobs')
.upsert(
  {
      photo_id: photo.id,
      album_id: photo.album_id,
      owner_id: photo.owner_id,
      original_path: photo.original_path,
      size: 'hd',
      status: 'pending',
      priority: 180,
      progress: 0,
      retry_count: 0,
      retries: 0,
      worker_id: null,
      claimed_by: null,
      started_at: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
      payload: {
        source: 'storage-consistency-repair',
      },
      },
  {
    onConflict: 'photo_id',
  }
)

  if (error) {
    console.error('[StorageConsistencyWorker] repair queue failed:', error.message)
  }
}

async function resolveMissingOrphanIssues() {
  const { data: issues, error } = await supabase
    .from('storage_consistency_issues')
    .select('id, storage_path')
    .eq('issue_type', 'storage_orphan_file')
    .eq('status', 'open')
    .limit(200)

  if (error) {
    console.error('[StorageConsistencyWorker] load orphan issues failed:', error.message)
    return
  }

  for (const issue of issues ?? []) {
    if (!issue.storage_path) continue

const stillExists = await storageFileExists(issue.storage_path)

if (stillExists === false) {
  await resolveIssue(
    'storage_orphan_file',
    issue.storage_path
  )
}
  }
}

async function cleanupOldIssues() {
  const cleanupTasks = [
    ['cleanup_storage_consistency_issues', { keep_days: 30 }],
    ['cleanup_worker_metrics', { keep_days: 30 }],
    ['cleanup_worker_logs', { keep_days: 90 }],
    ['cleanup_worker_heartbeats', { keep_days: 7 }],
  ] as const

  for (const [rpcName, params] of cleanupTasks) {
    const { error } = await supabase.rpc(rpcName, params)

    if (error) {
      console.error(
        `[StorageConsistencyWorker] ${rpcName} failed:`,
        error.message
      )
    } else {
      console.log(`[StorageConsistencyWorker] ${rpcName} complete`)
    }
  }
}