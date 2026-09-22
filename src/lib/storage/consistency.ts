import type { SupabaseClient } from '@supabase/supabase-js'
import { getStorageAdapter } from './index'
import { createStorageRef, normalizeObjectKey } from './paths'
import { normalizePhotoStorageProvider } from './photo-download-plan'
import type {
  StorageAdapter,
  StorageObjectListItem,
  StorageObjectRef,
  StorageProvider,
} from './types'

const PHOTO_PATH_FIELDS = [
  'storage_path',
  'original_path',
  'preview_path',
  'thumbnail_path',
  'sd_path',
  'hd_path',
  'uhd_path',
] as const

const ACTIVE_UPLOAD_STATUSES = ['issued', 'uploading', 'finalizing'] as const
const PROTECTED_DELETION_STATUSES = [
  'staged',
  'pending',
  'processing',
  'failed',
] as const

type AdapterFactory = (
  provider: StorageProvider,
  supabase: SupabaseClient
) => StorageAdapter

type PhotoStorageRow = {
  id: string
  owner_id?: string | null
  user_id?: string | null
  album_id: string
  storage_provider?: unknown
  storage_bucket?: string | null
  migration_status?: string | null
  migration_attempts?: number | string | null
  source_cleanup_status?: string | null
  storage_path?: string | null
  original_path?: string | null
  preview_path?: string | null
  thumbnail_path?: string | null
  sd_path?: string | null
  hd_path?: string | null
  uhd_path?: string | null
}

export type StorageConsistencyIssue = {
  issueType: 'missing_storage_file' | 'storage_size_mismatch'
  ownerId: string
  albumId: string | null
  photoId: string | null
  ref: StorageObjectRef
  expectedSizeBytes?: number | null
  actualSizeBytes?: number | null
  source: 'photos' | 'storage_assets'
}

export type StorageConsistencyScanResult = {
  photoRowsScanned: number
  assetRowsScanned: number
  checked: number
  healthy: number
  missing: number
  mismatched: number
  skipped: number
  healthyRefs: StorageObjectRef[]
  issues: StorageConsistencyIssue[]
}

export type StorageCleanupResult = {
  dryRun: boolean
  provider: StorageProvider
  bucket: string
  prefix: string
  scanned: number
  referenced: number
  orphanCount: number
  deletedCount: number
  failedCount: number
  truncated: boolean
  sample: string[]
}

function defaultAdapterFactory(
  provider: StorageProvider,
  supabase: SupabaseClient
) {
  return getStorageAdapter(provider, { supabase })
}

export function storageObjectIdentity(ref: StorageObjectRef) {
  return `${ref.provider}\0${ref.bucket}\0${ref.key}`
}

function normalizeProvider(value: unknown): StorageProvider | null {
  if (value === 'supabase' || value === 'r2') return value
  return null
}

function addRef(
  refs: Map<string, StorageObjectRef>,
  value: StorageObjectRef | null
) {
  if (!value) return
  refs.set(storageObjectIdentity(value), value)
}

function safeRef(params: {
  provider: StorageProvider
  bucket: string
  key?: string | null
}) {
  const key = params.key?.trim()
  if (!key || /^https?:\/\//i.test(key)) return null

  try {
    return createStorageRef({ ...params, key })
  } catch {
    return null
  }
}

function extractSupabasePublicObject(
  value?: string | null
): { bucket: string; key: string } | null {
  if (!value) return null
  const marker = '/storage/v1/object/public/'
  const markerIndex = value.indexOf(marker)
  if (markerIndex === -1) return null
  const object = value.slice(markerIndex + marker.length)
  const slashIndex = object.indexOf('/')
  if (slashIndex < 1) return null

  try {
    return {
      bucket: object.slice(0, slashIndex),
      key: normalizeObjectKey(decodeURIComponent(object.slice(slashIndex + 1))),
    }
  } catch {
    return null
  }
}

export function getPhotoStorageCandidates(
  photo: PhotoStorageRow,
  path: string
) {
  const provider = normalizePhotoStorageProvider(photo.storage_provider)

  if (provider === 'r2') {
    const bucket = photo.storage_bucket?.trim()
    if (!bucket) return []
    const ref = safeRef({ provider, bucket, key: path })
    return ref ? [ref] : []
  }

  const buckets = path.includes('/original/')
    ? ['originals', 'albums']
    : ['albums']

  return buckets
    .map((bucket) => safeRef({ provider, bucket, key: path }))
    .filter((ref): ref is StorageObjectRef => Boolean(ref))
}

/**
 * Phase 15 keeps the verified Supabase copy as a rollback source until the
 * dedicated source-cleanup workflow has completed. Generic orphan cleanup
 * must not infer that this deliberately retained copy is an orphan merely
 * because the photo's active provider is now R2.
 */
export function getProtectedSupabaseSourceCandidates(
  photo: PhotoStorageRow,
  path: string
) {
  if (
    normalizePhotoStorageProvider(photo.storage_provider) !== 'r2' ||
    photo.migration_status !== 'completed' ||
    Number(photo.migration_attempts || 0) < 1 ||
    photo.source_cleanup_status === 'completed'
  ) {
    return []
  }

  const buckets = path.includes('/original/')
    ? ['originals', 'albums']
    : ['albums']

  return buckets
    .map((bucket) =>
      safeRef({ provider: 'supabase', bucket, key: path })
    )
    .filter((ref): ref is StorageObjectRef => Boolean(ref))
}

async function selectRequired(
  promise: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  label: string
) {
  const { data, error } = await promise
  if (error) {
    throw new Error(`Unable to build ${label} storage references: ${error.message}`)
  }
  return Array.isArray(data) ? data : []
}

/**
 * Builds the complete provider-aware reference set before orphan detection.
 * References currently being uploaded or deleted are intentionally protected.
 */
export async function collectReferencedStorageObjects(
  supabase: SupabaseClient
) {
  const refs = new Map<string, StorageObjectRef>()
  const photoResult = await supabase
    .from('photos')
    .select(
      'id, album_id, owner_id, user_id, storage_provider, storage_bucket, migration_status, migration_attempts, source_cleanup_status, storage_path, original_path, preview_path, thumbnail_path, sd_path, hd_path, uhd_path'
    )
  let photoData: unknown[] | null = photoResult.data
  let photoError = photoResult.error

  if (photoError) {
    const migrationFallback = await supabase.from('photos').select(
      'id, album_id, owner_id, user_id, storage_provider, storage_bucket, migration_status, migration_attempts, storage_path, original_path, preview_path, thumbnail_path, sd_path, hd_path, uhd_path'
    )
    photoData = migrationFallback.data
    photoError = migrationFallback.error
  }
  if (photoError) {
    const legacyFallback = await supabase.from('photos').select(
      'id, album_id, owner_id, user_id, storage_path, original_path, preview_path, thumbnail_path, sd_path, hd_path, uhd_path'
    )
    photoData = legacyFallback.data
    photoError = legacyFallback.error
  }
  if (photoError) {
    throw new Error(`Unable to build photo storage references: ${photoError.message}`)
  }
  const photos = (photoData || []) as PhotoStorageRow[]

  for (const photo of photos) {
    for (const field of PHOTO_PATH_FIELDS) {
      const path = photo[field]
      if (!path) continue
      for (const ref of getPhotoStorageCandidates(photo, path)) addRef(refs, ref)
      for (const ref of getProtectedSupabaseSourceCandidates(photo, path)) {
        addRef(refs, ref)
      }
    }
  }

  const assets = (await selectRequired(
    supabase
      .from('storage_assets')
      .select('storage_provider, storage_bucket, object_key')
      .in('status', ['uploading', 'active', 'failed', 'deleting']),
    'storage_assets'
  )) as Array<Record<string, unknown>>

  for (const asset of assets) {
    const provider = normalizeProvider(asset.storage_provider)
    if (!provider) continue
    addRef(
      refs,
      safeRef({
        provider,
        bucket: String(asset.storage_bucket || ''),
        key: String(asset.object_key || ''),
      })
    )
  }

  const sessions = (await selectRequired(
    supabase
      .from('photo_upload_sessions')
      .select('storage_provider, storage_bucket, object_key')
      .in('status', [...ACTIVE_UPLOAD_STATUSES]),
    'photo_upload_sessions'
  )) as Array<Record<string, unknown>>

  for (const session of sessions) {
    const provider = normalizeProvider(session.storage_provider)
    if (!provider) continue
    addRef(
      refs,
      safeRef({
        provider,
        bucket: String(session.storage_bucket || ''),
        key: String(session.object_key || ''),
      })
    )
  }

  const deletionJobs = (await selectRequired(
    supabase
      .from('storage_deletion_jobs')
      .select('storage_provider, storage_bucket, object_key')
      .in('status', [...PROTECTED_DELETION_STATUSES]),
    'storage_deletion_jobs'
  )) as Array<Record<string, unknown>>

  for (const job of deletionJobs) {
    const provider = normalizeProvider(job.storage_provider)
    if (!provider) continue
    addRef(
      refs,
      safeRef({
        provider,
        bucket: String(job.storage_bucket || ''),
        key: String(job.object_key || ''),
      })
    )
  }

  // `cover_path` and `cover_storage_path` were explored during the storage
  // migration design but were never part of the canonical albums schema.
  // Query only deployed columns, with a pre-preset fallback for databases
  // that have not received the album preset column yet.
  const albumResult = await supabase
    .from('albums')
    .select('cover_url, album_preset_path')
  let albumData: unknown[] | null = albumResult.data
  let albumError = albumResult.error

  if (albumError) {
    const fallback = await supabase.from('albums').select('cover_url')
    albumData = fallback.data
    albumError = fallback.error
  }
  if (albumError) {
    throw new Error(
      `Unable to build album legacy assets storage references: ${albumError.message}`
    )
  }
  const albums = (albumData || []) as Array<Record<string, unknown>>

  for (const album of albums) {
    const presetKey =
      typeof album.album_preset_path === 'string'
        ? album.album_preset_path
        : null
    if (presetKey) {
      addRef(
        refs,
        safeRef({ provider: 'supabase', bucket: 'albums', key: presetKey })
      )
    }
    const publicObject = extractSupabasePublicObject(
      typeof album.cover_url === 'string' ? album.cover_url : null
    )
    if (publicObject) {
      addRef(refs, safeRef({ provider: 'supabase', ...publicObject }))
    }
  }

  const cameraResult = await supabase
    .from('camera_live_imports')
    .select('storage_provider, storage_bucket, storage_path')
  let cameraData: unknown[] | null = cameraResult.data
  let cameraError = cameraResult.error
  if (cameraError) {
    const fallback = await supabase
      .from('camera_live_imports')
      .select('storage_path')
    cameraData = fallback.data
    cameraError = fallback.error
  }
  if (cameraError) {
    throw new Error(
      `Unable to build camera storage references: ${cameraError.message}`
    )
  }
  const cameraImports = (cameraData || []) as Array<Record<string, unknown>>

  for (const item of cameraImports) {
    const provider = normalizeProvider(item.storage_provider) || 'supabase'
    addRef(
      refs,
      safeRef({
        provider,
        bucket: String(item.storage_bucket || (provider === 'supabase' ? 'albums' : '')),
        key: typeof item.storage_path === 'string' ? item.storage_path : null,
      })
    )
  }

  const momentResult = await supabase
    .from('guest_moments')
    .select('storage_paths, storage_asset_ids')
  let momentData: unknown[] | null = momentResult.data
  let momentError = momentResult.error
  if (momentError) {
    const fallback = await supabase.from('guest_moments').select('storage_paths')
    momentData = fallback.data
    momentError = fallback.error
  }
  if (momentError) {
    throw new Error(
      `Unable to build Guest Moment storage references: ${momentError.message}`
    )
  }
  const moments = (momentData || []) as Array<Record<string, unknown>>

  for (const moment of moments) {
    const assetIds = Array.isArray(moment.storage_asset_ids)
      ? moment.storage_asset_ids
      : []
    if (assetIds.length > 0 || !Array.isArray(moment.storage_paths)) continue
    for (const key of moment.storage_paths) {
      if (typeof key !== 'string') continue
      addRef(
        refs,
        safeRef({ provider: 'supabase', bucket: 'guest-moments', key })
      )
    }
  }

  const portfolioResult = await supabase
    .from('portfolios')
    .select('hero_photo_url, gallery_urls, storage_asset_ids')
  let portfolioData: unknown[] | null = portfolioResult.data
  let portfolioError = portfolioResult.error
  if (portfolioError) {
    const fallback = await supabase
      .from('portfolios')
      .select('hero_photo_url, gallery_urls')
    portfolioData = fallback.data
    portfolioError = fallback.error
  }
  if (portfolioError) {
    throw new Error(
      `Unable to build Portfolio storage references: ${portfolioError.message}`
    )
  }
  const portfolios = (portfolioData || []) as Array<Record<string, unknown>>

  for (const portfolio of portfolios) {
    const assetIds = Array.isArray(portfolio.storage_asset_ids)
      ? portfolio.storage_asset_ids
      : []
    if (assetIds.length > 0) continue
    const urls = [
      portfolio.hero_photo_url,
      ...(Array.isArray(portfolio.gallery_urls) ? portfolio.gallery_urls : []),
    ]
    for (const url of urls) {
      const publicObject = extractSupabasePublicObject(
        typeof url === 'string' ? url : null
      )
      if (publicObject) {
        addRef(refs, safeRef({ provider: 'supabase', ...publicObject }))
      }
    }
  }

  // Avatars currently live in the `albums` bucket while their URL is stored
  // in Supabase Auth user metadata, not in columns on `public.profiles`.
  // They cannot be collected through the application-schema client here, so
  // `/profile/` keys remain categorically protected by isUnsafeCleanupKey().

  return refs
}

async function findExistingCandidate(params: {
  refs: StorageObjectRef[]
  supabase: SupabaseClient
  adapterFactory: AdapterFactory
}) {
  for (const ref of params.refs) {
    const head = await params.adapterFactory(ref.provider, params.supabase)
      .objectExists(ref)
    if (head.exists) return { ref, head }
  }
  return null
}

export async function scanTrackedStorageObjects(params: {
  supabase: SupabaseClient
  limit?: number
  offset?: number
  adapterFactory?: AdapterFactory
}) {
  const limit = Math.max(1, Math.min(params.limit ?? 250, 2000))
  const offset = Math.max(0, Math.floor(params.offset ?? 0))
  const adapterFactory = params.adapterFactory ?? defaultAdapterFactory
  const result: StorageConsistencyScanResult = {
    photoRowsScanned: 0,
    assetRowsScanned: 0,
    checked: 0,
    healthy: 0,
    missing: 0,
    mismatched: 0,
    skipped: 0,
    healthyRefs: [],
    issues: [],
  }
  const { data: photos, error: photoError } = await params.supabase
    .from('photos')
    .select(
      'id, album_id, owner_id, user_id, storage_provider, storage_bucket, storage_path, original_path, preview_path, thumbnail_path, sd_path, hd_path, uhd_path'
    )
    .order('updated_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (photoError) throw new Error(photoError.message)

  result.photoRowsScanned = photos?.length || 0

  for (const photo of (photos || []) as PhotoStorageRow[]) {
    const ownerId = String(photo.owner_id || photo.user_id || '')
    for (const field of PHOTO_PATH_FIELDS) {
      const path = photo[field]
      if (!path) continue
      const candidates = getPhotoStorageCandidates(photo, path)
      if (!ownerId || candidates.length === 0) {
        result.skipped += 1
        continue
      }
      result.checked += 1
      const existing = await findExistingCandidate({
        refs: candidates,
        supabase: params.supabase,
        adapterFactory,
      })
      if (existing) {
        result.healthy += 1
        // Resolve either legacy Supabase bucket candidate. Old originals may
        // legitimately live in `originals` or `albums` during migration.
        result.healthyRefs.push(...candidates)
      } else {
        result.missing += 1
        result.issues.push({
          issueType: 'missing_storage_file',
          ownerId,
          albumId: photo.album_id,
          photoId: photo.id,
          ref: candidates[0],
          source: 'photos',
        })
      }
    }
  }

  const { data: assets, error: assetError } = await params.supabase
    .from('storage_assets')
    .select(
      'id, owner_id, album_id, storage_provider, storage_bucket, object_key, size_bytes'
    )
    .in('status', ['active', 'deleting'])
    .order('updated_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (assetError) {
    // Phase 10 may not have been deployed yet. The legacy photo scan remains
    // useful and must not take the worker down during a staged rollout.
    console.warn('[storage-consistency] storage_assets skipped:', assetError.message)
    return result
  }

  result.assetRowsScanned = assets?.length || 0

  for (const asset of assets || []) {
    const provider = normalizeProvider(asset.storage_provider)
    const ref = provider
      ? safeRef({
          provider,
          bucket: asset.storage_bucket,
          key: asset.object_key,
        })
      : null
    if (!ref) {
      result.skipped += 1
      continue
    }
    result.checked += 1
    const head = await adapterFactory(provider!, params.supabase).objectExists(ref)
    if (!head.exists) {
      result.missing += 1
      result.issues.push({
        issueType: 'missing_storage_file',
        ownerId: asset.owner_id,
        albumId: asset.album_id,
        photoId: null,
        ref,
        expectedSizeBytes: Number(asset.size_bytes),
        actualSizeBytes: null,
        source: 'storage_assets',
      })
      continue
    }
    const expectedSize = Number(asset.size_bytes)
    if (head.sizeBytes != null && head.sizeBytes !== expectedSize) {
      result.mismatched += 1
      result.issues.push({
        issueType: 'storage_size_mismatch',
        ownerId: asset.owner_id,
        albumId: asset.album_id,
        photoId: null,
        ref,
        expectedSizeBytes: expectedSize,
        actualSizeBytes: head.sizeBytes,
        source: 'storage_assets',
      })
    } else {
      result.healthy += 1
      result.healthyRefs.push(ref)
    }
  }

  return result
}

function isUnsafeCleanupKey(key: string) {
  const normalized = key.toLowerCase()
  return (
    normalized.includes('/preset/') ||
    normalized.includes('/presets/') ||
    normalized.includes('/avatar/') ||
    normalized.includes('/avatars/') ||
    normalized.includes('/profile/') ||
    normalized.includes('/cover/') ||
    normalized.includes('/covers/') ||
    normalized.endsWith('.xmp')
  )
}

async function listInventory(params: {
  adapter: StorageAdapter
  bucket: string
  prefix: string
  scanLimit: number
}) {
  if (!params.adapter.listObjects) {
    throw new Error(`${params.adapter.provider} adapter cannot list objects`)
  }
  const objects: StorageObjectListItem[] = []
  let cursor: string | null = null
  let truncated = false

  do {
    const remaining = params.scanLimit - objects.length
    if (remaining <= 0) {
      truncated = true
      break
    }
    const page = await params.adapter.listObjects({
      bucket: params.bucket,
      prefix: params.prefix || undefined,
      cursor,
      limit: Math.min(1000, remaining),
    })
    objects.push(...page.objects)
    cursor = page.nextCursor
  } while (cursor)

  return { objects, truncated: truncated || Boolean(cursor) }
}

export async function runStorageOrphanCleanup(params: {
  supabase: SupabaseClient
  provider: StorageProvider
  bucket: string
  prefix?: string
  dryRun?: boolean
  maxDelete?: number
  scanLimit?: number
  minimumAgeMs?: number
  allowR2Delete?: boolean
  adapterFactory?: AdapterFactory
}): Promise<StorageCleanupResult> {
  const dryRun = params.dryRun !== false
  const maxDelete = Math.max(1, Math.min(params.maxDelete ?? 100, 500))
  const scanLimit = Math.max(1, Math.min(params.scanLimit ?? 10_000, 100_000))
  const minimumAgeMs = Math.max(
    60 * 60 * 1000,
    params.minimumAgeMs ?? 24 * 60 * 60 * 1000
  )

  if (!dryRun && params.provider === 'r2' && !params.allowR2Delete) {
    throw new Error('R2 orphan deletion is disabled by rollout policy')
  }

  const adapterFactory = params.adapterFactory ?? defaultAdapterFactory
  const adapter = adapterFactory(params.provider, params.supabase)
  const inventory = await listInventory({
    adapter,
    bucket: params.bucket,
    prefix: params.prefix?.trim() || '',
    scanLimit,
  })
  const referenced = await collectReferencedStorageObjects(params.supabase)
  const now = Date.now()
  const orphans = inventory.objects.filter((item) => {
    if (referenced.has(storageObjectIdentity(item.ref))) return false
    if (isUnsafeCleanupKey(item.ref.key)) return false
    if (!item.lastModified) return false
    return now - item.lastModified.getTime() >= minimumAgeMs
  })
  const targets = orphans.slice(0, maxDelete).map((item) => item.ref)
  let deletedCount = 0
  let failedCount = 0

  if (!dryRun && targets.length > 0) {
    const deletion = await adapter.deleteObjects(targets)
    deletedCount = deletion.deleted.length
    failedCount = deletion.failed.length
  }

  return {
    dryRun,
    provider: params.provider,
    bucket: params.bucket,
    prefix: params.prefix?.trim() || '',
    scanned: inventory.objects.length,
    referenced: inventory.objects.filter((item) =>
      referenced.has(storageObjectIdentity(item.ref))
    ).length,
    orphanCount: orphans.length,
    deletedCount,
    failedCount,
    truncated: inventory.truncated,
    sample: orphans.slice(0, 20).map((item) => item.ref.key),
  }
}

export async function cleanupExpiredStorageReservations(params: {
  supabase: SupabaseClient
  dryRun?: boolean
  limit?: number
  allowR2Delete?: boolean
  adapterFactory?: AdapterFactory
}) {
  const dryRun = params.dryRun !== false
  const limit = Math.max(1, Math.min(params.limit ?? 100, 500))
  const adapterFactory = params.adapterFactory ?? defaultAdapterFactory
  const now = new Date().toISOString()
  let inspected = 0
  let expired = 0
  let deleted = 0
  let failed = 0
  let blocked = 0

  const { data: sessions, error: sessionError } = await params.supabase
    .from('photo_upload_sessions')
    .select('id, storage_provider, storage_bucket, object_key')
    .in('status', [...ACTIVE_UPLOAD_STATUSES])
    .lt('expires_at', now)
    .order('expires_at', { ascending: true })
    .limit(limit)

  if (sessionError) {
    console.warn('[storage-consistency] expired sessions skipped:', sessionError.message)
  } else {
    for (const session of sessions || []) {
      inspected += 1
      const provider = normalizeProvider(session.storage_provider)
      const ref = provider
        ? safeRef({
            provider,
            bucket: session.storage_bucket,
            key: session.object_key,
          })
        : null
      if (!ref) {
        failed += 1
        continue
      }
      if (dryRun) continue
      if (ref.provider === 'r2' && !params.allowR2Delete) {
        blocked += 1
        continue
      }
      try {
        const adapter = adapterFactory(provider!, params.supabase)
        const head = await adapter.objectExists(ref)
        if (head.exists) {
          await adapter.deleteObject(ref)
          deleted += 1
        }
        const { error } = await params.supabase
          .from('photo_upload_sessions')
          .update({
            status: 'expired',
            error: 'Upload reservation expired before finalization',
            updated_at: now,
          })
          .eq('id', session.id)
          .in('status', [...ACTIVE_UPLOAD_STATUSES])
        if (error) throw new Error(error.message)
        expired += 1
      } catch (error) {
        failed += 1
        console.error('[storage-consistency] session cleanup failed:', error)
      }
    }
  }

  const remaining = Math.max(0, limit - inspected)
  if (remaining > 0) {
    const { data: assets, error: assetError } = await params.supabase
      .from('storage_assets')
      .select('id, storage_provider, storage_bucket, object_key')
      .in('status', ['uploading', 'failed'])
      .lt('expires_at', now)
      .order('expires_at', { ascending: true })
      .limit(remaining)

    if (assetError) {
      console.warn('[storage-consistency] expired assets skipped:', assetError.message)
    } else {
      for (const asset of assets || []) {
        inspected += 1
        const provider = normalizeProvider(asset.storage_provider)
        const ref = provider
          ? safeRef({
              provider,
              bucket: asset.storage_bucket,
              key: asset.object_key,
            })
          : null
        if (!ref) {
          failed += 1
          continue
        }
        if (dryRun) continue
        if (ref.provider === 'r2' && !params.allowR2Delete) {
          blocked += 1
          continue
        }
        try {
          const adapter = adapterFactory(provider!, params.supabase)
          const head = await adapter.objectExists(ref)
          if (head.exists) {
            await adapter.deleteObject(ref)
            deleted += 1
          }
          const { error } = await params.supabase
            .from('storage_assets')
            .delete()
            .eq('id', asset.id)
            .in('status', ['uploading', 'failed'])
          if (error) throw new Error(error.message)
          expired += 1
        } catch (error) {
          failed += 1
          console.error('[storage-consistency] asset cleanup failed:', error)
        }
      }
    }
  }

  return { dryRun, inspected, expired, deleted, failed, blocked }
}
