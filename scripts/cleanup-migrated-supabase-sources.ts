import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  deleteVerifiedPhotoSources,
  getR2Config,
  getStorageAdapter,
  inspectPhotoSourceCleanup,
  type PhotoSourceCleanupRow,
} from '../src/lib/storage'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const APPLY_CONFIRMATION = 'DELETE_VERIFIED_SUPABASE_SOURCES'

const PHOTO_SELECT = `
  id,
  owner_id,
  user_id,
  album_id,
  storage_provider,
  storage_bucket,
  storage_version,
  migration_status,
  migration_attempts,
  migration_completed_at,
  source_cleanup_status,
  source_cleanup_after,
  source_cleanup_attempts,
  source_cleanup_started_at,
  storage_path,
  original_path,
  preview_path,
  thumbnail_path,
  sd_path,
  hd_path,
  uhd_path,
  file_size_bytes,
  original_size_bytes,
  preview_size_bytes,
  thumbnail_size_bytes,
  mime_type,
  processing_status,
  created_at,
  updated_at
`

type CliOptions = {
  apply: boolean
  limit: number
  includeFailed: boolean
  recoverStale: boolean
  staleAfterSeconds: number
  minimumAgeDays: number
  photoId: string | null
}

type ClaimRow = {
  photo_id: string
  photo_owner_id: string | null
  photo_user_id: string | null
  photo_album_id: string
  photo_storage_bucket: string
  photo_storage_version: number | null
  photo_migration_status: string | null
  photo_migration_attempts: number | string | null
  photo_migration_completed_at: string | null
  photo_source_cleanup_status: string | null
  photo_source_cleanup_after: string | null
  photo_source_cleanup_attempts: number | string | null
  photo_storage_path: string | null
  photo_original_path: string | null
  photo_preview_path: string | null
  photo_thumbnail_path: string | null
  photo_sd_path: string | null
  photo_hd_path: string | null
  photo_uhd_path: string | null
  photo_file_size_bytes: number | string | null
  photo_original_size_bytes: number | string | null
  photo_preview_size_bytes: number | string | null
  photo_thumbnail_size_bytes: number | string | null
  photo_mime_type: string | null
}

function optionValue(name: string) {
  const prefix = `--${name}=`
  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length)
}

function integerOption(name: string, fallback: number, min: number, max: number) {
  const raw = optionValue(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function parseOptions(): CliOptions {
  const args = process.argv.slice(2)
  const knownFlags = new Set([
    '--apply',
    '--retry-failed',
    '--recover-stale',
  ])

  for (const arg of args) {
    if (
      knownFlags.has(arg) ||
      arg.startsWith('--limit=') ||
      arg.startsWith('--stale-after-seconds=') ||
      arg.startsWith('--minimum-age-days=') ||
      arg.startsWith('--photo-id=')
    ) {
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  const photoId = optionValue('photo-id')?.trim() || null
  if (photoId && !UUID_PATTERN.test(photoId)) {
    throw new Error('--photo-id must be a UUID')
  }

  return {
    apply: args.includes('--apply'),
    limit: integerOption('limit', 5, 1, 20),
    includeFailed: args.includes('--retry-failed'),
    recoverStale: args.includes('--recover-stale'),
    staleAfterSeconds: integerOption(
      'stale-after-seconds',
      3600,
      900,
      604800
    ),
    minimumAgeDays: integerOption('minimum-age-days', 30, 7, 365),
    photoId,
  }
}

function requireApplyAuthorization(options: CliOptions) {
  if (!options.apply) return

  if (
    process.env.STORAGE_SOURCE_CLEANUP_APPLY_ENABLED
      ?.trim()
      .toLowerCase() !== 'true'
  ) {
    throw new Error(
      'Apply mode is disabled. Set STORAGE_SOURCE_CLEANUP_APPLY_ENABLED=true only in the isolated cleanup runner.'
    )
  }

  if (process.env.STORAGE_SOURCE_CLEANUP_CONFIRM?.trim() !== APPLY_CONFIRMATION) {
    throw new Error(
      `Apply confirmation is missing. Set STORAGE_SOURCE_CLEANUP_CONFIRM=${APPLY_CONFIRMATION} after reviewing the dry-run.`
    )
  }
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Missing Supabase service environment')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function mapClaim(row: ClaimRow): PhotoSourceCleanupRow {
  return {
    id: row.photo_id,
    owner_id: row.photo_owner_id,
    user_id: row.photo_user_id,
    album_id: row.photo_album_id,
    storage_provider: 'r2',
    storage_bucket: row.photo_storage_bucket,
    storage_version: row.photo_storage_version,
    migration_status: row.photo_migration_status,
    migration_attempts: row.photo_migration_attempts,
    migration_completed_at: row.photo_migration_completed_at,
    source_cleanup_status: row.photo_source_cleanup_status,
    source_cleanup_after: row.photo_source_cleanup_after,
    source_cleanup_attempts: row.photo_source_cleanup_attempts,
    storage_path: row.photo_storage_path,
    original_path: row.photo_original_path,
    preview_path: row.photo_preview_path,
    thumbnail_path: row.photo_thumbnail_path,
    sd_path: row.photo_sd_path,
    hd_path: row.photo_hd_path,
    uhd_path: row.photo_uhd_path,
    file_size_bytes: row.photo_file_size_bytes,
    original_size_bytes: row.photo_original_size_bytes,
    preview_size_bytes: row.photo_preview_size_bytes,
    thumbnail_size_bytes: row.photo_thumbnail_size_bytes,
    mime_type: row.photo_mime_type,
  }
}

async function loadActivePhotoIds(
  supabase: SupabaseClient,
  photoIds: string[]
) {
  if (photoIds.length === 0) return new Set<string>()

  const { data, error } = await supabase
    .from('photo_jobs')
    .select('photo_id')
    .in('photo_id', photoIds)
    .in('status', ['pending', 'processing'])

  if (error) throw new Error(`Unable to check active photo jobs: ${error.message}`)
  return new Set((data || []).map((row) => String(row.photo_id)))
}

async function loadDryRunRows(
  supabase: SupabaseClient,
  options: CliOptions
) {
  const statuses = ['retained']
  if (options.includeFailed) statuses.push('failed')
  if (options.recoverStale) statuses.push('deleting')

  const now = new Date()
  let query = supabase
    .from('photos')
    .select(PHOTO_SELECT)
    .eq('storage_provider', 'r2')
    .eq('migration_status', 'completed')
    .gt('migration_attempts', 0)
    .in('source_cleanup_status', statuses)
    .lte('source_cleanup_after', now.toISOString())
    .order('source_cleanup_after', { ascending: true })
    .limit(Math.min(options.limit * 5, 100))

  if (options.photoId) query = query.eq('id', options.photoId)

  const { data, error } = await query
  if (error) {
    throw new Error(
      `Unable to load source-cleanup rows. Apply Phase 15 SQL first: ${error.message}`
    )
  }

  const rows = (data || []) as Array<PhotoSourceCleanupRow & {
    processing_status?: string | null
    source_cleanup_started_at?: string | null
    created_at?: string | null
    updated_at?: string | null
  }>
  const activePhotoIds = await loadActivePhotoIds(
    supabase,
    rows.map((row) => row.id)
  )
  const staleBefore = now.getTime() - options.staleAfterSeconds * 1000
  const minimumAgeBefore =
    now.getTime() - options.minimumAgeDays * 24 * 60 * 60 * 1000

  return rows
    .filter((row) => {
      if (activePhotoIds.has(row.id)) return false
      if (
        ['pending', 'processing', 'uploading', 'finalizing'].includes(
          String(row.processing_status || '')
        )
      ) {
        return false
      }

      const migratedAt = new Date(
        String(row.migration_completed_at || row.updated_at || row.created_at || 0)
      ).getTime()
      if (!Number.isFinite(migratedAt) || migratedAt > minimumAgeBefore) {
        return false
      }

      if (row.source_cleanup_status !== 'deleting') return true
      const startedAt = new Date(
        String(row.source_cleanup_started_at || row.updated_at || row.created_at || 0)
      ).getTime()
      return Number.isFinite(startedAt) && startedAt < staleBefore
    })
    .slice(0, options.limit)
}

async function claimRows(supabase: SupabaseClient, options: CliOptions) {
  const { data, error } = await supabase.rpc('claim_photo_source_cleanups', {
    p_limit: options.limit,
    p_include_failed: options.includeFailed,
    p_recover_stale: options.recoverStale,
    p_stale_after_seconds: options.staleAfterSeconds,
    p_minimum_age_days: options.minimumAgeDays,
    p_photo_id: options.photoId,
  })

  if (error) {
    throw new Error(
      `Unable to claim source-cleanup rows. Apply Phase 15 SQL first: ${error.message}`
    )
  }

  return ((data || []) as ClaimRow[]).map(mapClaim)
}

async function markCompleted(supabase: SupabaseClient, photoId: string) {
  const { data, error } = await supabase
    .from('photos')
    .update({
      source_cleanup_status: 'completed',
      source_cleanup_error: null,
      source_cleanup_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', photoId)
    .eq('storage_provider', 'r2')
    .eq('migration_status', 'completed')
    .eq('source_cleanup_status', 'deleting')
    .select('id')
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message || 'Source-cleanup claim was lost')
  }
}

async function markFailed(
  supabase: SupabaseClient,
  photoId: string,
  error: unknown
) {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 2000)
  const result = await supabase
    .from('photos')
    .update({
      source_cleanup_status: 'failed',
      source_cleanup_error: message,
      source_cleanup_completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photoId)
    .eq('storage_provider', 'r2')
    .eq('migration_status', 'completed')
    .eq('source_cleanup_status', 'deleting')

  if (result.error) {
    console.error(
      `[source-cleanup] unable to record failure for ${photoId}: ${result.error.message}`
    )
  }
}

async function main() {
  const options = parseOptions()
  requireApplyAuthorization(options)

  const supabase = getSupabaseAdmin()
  const r2Config = getR2Config()
  const sourceAdapter = getStorageAdapter('supabase', { supabase })
  const targetAdapter = getStorageAdapter('r2')
  const photos = options.apply
    ? await claimRows(supabase, options)
    : await loadDryRunRows(supabase, options)

  console.log(
    JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      selected: photos.length,
      minimumAgeDays: options.minimumAgeDays,
      includeFailed: options.includeFailed,
      recoverStale: options.recoverStale,
      supabaseSourceDeletion: options.apply,
      r2Deletion: false,
    })
  )

  let succeeded = 0
  let failed = 0
  let sourceObjectsFound = 0
  let deleted = 0

  for (const photo of photos) {
    try {
      if (!options.apply) {
        const inspections = await inspectPhotoSourceCleanup({
          photo,
          targetBucket: r2Config.bucketName,
          sourceAdapter,
          targetAdapter,
        })
        const sources = inspections.flatMap((item) => item.sources)
        sourceObjectsFound += sources.length
        console.log(
          JSON.stringify({
            photoId: photo.id,
            result: 'dry-run-ready',
            objects: inspections.length,
            sourceObjectsFound: sources.length,
            sourceDeletion: false,
            r2Deletion: false,
          })
        )
        succeeded += 1
        continue
      }

      const result = await deleteVerifiedPhotoSources({
        photo,
        targetBucket: r2Config.bucketName,
        sourceAdapter,
        targetAdapter,
      })
      sourceObjectsFound += result.sourceObjectsFound
      deleted += result.deleted

      if (result.failed.length > 0) {
        throw new Error(
          result.failed
            .map((item) => `${item.ref.bucket}/${item.ref.key}: ${item.error}`)
            .join('; ')
        )
      }

      await markCompleted(supabase, photo.id)
      console.log(
        JSON.stringify({
          photoId: photo.id,
          result: 'completed',
          objects: result.objects,
          sourceObjectsFound: result.sourceObjectsFound,
          deleted: result.deleted,
          r2Deletion: false,
        })
      )
      succeeded += 1
    } catch (error) {
      failed += 1
      if (options.apply) await markFailed(supabase, photo.id, error)
      console.error(
        JSON.stringify({
          photoId: photo.id,
          result: 'failed',
          error: error instanceof Error ? error.message : String(error),
          r2Deletion: false,
        })
      )
    }
  }

  console.log(
    JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      selected: photos.length,
      succeeded,
      failed,
      sourceObjectsFound,
      deleted,
      supabaseSourceDeletion: options.apply,
      r2Deletion: false,
    })
  )

  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
