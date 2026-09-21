import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  buildPhotoStorageMigrationCompletion,
  copyPhotoStorageMigration,
  getR2Config,
  getStorageAdapter,
  inspectPhotoStorageMigration,
  verifyPhotoStorageMigration,
  type PhotoStorageMigrationRow,
} from '../src/lib/storage'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const PHOTO_SELECT = `
  id,
  owner_id,
  user_id,
  album_id,
  storage_provider,
  storage_bucket,
  storage_version,
  migration_status,
  migration_started_at,
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
  created_at
`

type CliOptions = {
  apply: boolean
  limit: number
  includeFailed: boolean
  recoverStale: boolean
  staleAfterSeconds: number
  photoId: string | null
  maxObjectBytes: number
}

type ClaimRow = {
  photo_id: string
  photo_owner_id: string | null
  photo_user_id: string | null
  photo_album_id: string
  photo_storage_version: number | null
  photo_migration_status: string | null
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
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
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
      arg.startsWith('--photo-id=') ||
      arg.startsWith('--max-object-bytes=')
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
    limit: integerOption('limit', 5, 1, 50),
    includeFailed: args.includes('--retry-failed'),
    recoverStale: args.includes('--recover-stale'),
    staleAfterSeconds: integerOption(
      'stale-after-seconds',
      3600,
      300,
      604800
    ),
    photoId,
    maxObjectBytes: integerOption(
      'max-object-bytes',
      512 * 1024 * 1024,
      1,
      Number.MAX_SAFE_INTEGER
    ),
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

function mapClaim(row: ClaimRow): PhotoStorageMigrationRow {
  return {
    id: row.photo_id,
    owner_id: row.photo_owner_id,
    user_id: row.photo_user_id,
    album_id: row.photo_album_id,
    storage_provider: 'supabase',
    storage_bucket: null,
    storage_version: row.photo_storage_version,
    migration_status: row.photo_migration_status,
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

async function loadDryRunRows(
  supabase: SupabaseClient,
  options: CliOptions
) {
  const statuses = ['pending']
  if (options.includeFailed) statuses.push('failed')
  if (options.recoverStale) statuses.push('copying', 'verifying')

  let query = supabase
    .from('photos')
    .select(PHOTO_SELECT)
    .eq('storage_provider', 'supabase')
    .in('migration_status', statuses)
    .order('created_at', { ascending: true })
    .limit(Math.min(options.limit * 5, 250))

  if (options.photoId) query = query.eq('id', options.photoId)

  const { data, error } = await query
  if (error) throw new Error(`Unable to load migration rows: ${error.message}`)

  const staleBefore = Date.now() - options.staleAfterSeconds * 1000

  return (data || [])
    .filter((row) => {
      if (['pending', 'processing', 'uploading', 'finalizing'].includes(
        String(row.processing_status || '')
      )) return false

      if (!['copying', 'verifying'].includes(String(row.migration_status))) {
        return true
      }

      const started = new Date(String(row.migration_started_at || 0)).getTime()
      return Number.isFinite(started) && started < staleBefore
    })
    .slice(0, options.limit) as PhotoStorageMigrationRow[]
}

async function claimRows(supabase: SupabaseClient, options: CliOptions) {
  const { data, error } = await supabase.rpc(
    'claim_photo_storage_migrations',
    {
      p_limit: options.limit,
      p_include_failed: options.includeFailed,
      p_recover_stale: options.recoverStale,
      p_stale_after_seconds: options.staleAfterSeconds,
      p_photo_id: options.photoId,
    }
  )

  if (error) {
    throw new Error(
      `Unable to claim migration rows. Apply Phase 13 SQL first: ${error.message}`
    )
  }

  return ((data || []) as ClaimRow[]).map(mapClaim)
}

async function moveToVerifying(supabase: SupabaseClient, photoId: string) {
  const { data, error } = await supabase
    .from('photos')
    .update({
      migration_status: 'verifying',
      migration_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photoId)
    .eq('storage_provider', 'supabase')
    .eq('migration_status', 'copying')
    .select('id')
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message || 'Migration claim was lost before verification')
  }
}

async function completeMigration(params: {
  supabase: SupabaseClient
  photo: PhotoStorageMigrationRow
  completion: ReturnType<typeof buildPhotoStorageMigrationCompletion>
}) {
  const { data, error } = await params.supabase
    .from('photos')
    .update({
      ...params.completion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.photo.id)
    .eq('storage_provider', 'supabase')
    .eq('migration_status', 'verifying')
    .select('id')
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message || 'Migration claim was lost before completion')
  }

  if (params.completion.public_url) {
    const { error: coverError } = await params.supabase
      .from('albums')
      .update({ cover_url: params.completion.public_url })
      .eq('cover_photo_id', params.photo.id)

    if (coverError) {
      console.warn(
        `[storage-migration] cover refresh skipped for ${params.photo.id}: ${coverError.message}`
      )
    }
  }
}

async function markFailed(
  supabase: SupabaseClient,
  photoId: string,
  error: unknown
) {
  const message = (
    error instanceof Error ? error.message : 'Unknown migration error'
  ).slice(0, 2000)

  const result = await supabase
    .from('photos')
    .update({
      migration_status: 'failed',
      migration_error: message,
      migration_completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photoId)
    .eq('storage_provider', 'supabase')
    .in('migration_status', ['copying', 'verifying'])

  if (result.error) {
    console.error(
      `[storage-migration] unable to record failure for ${photoId}: ${result.error.message}`
    )
  }
}

async function main() {
  const options = parseOptions()

  if (
    options.apply &&
    process.env.STORAGE_MIGRATION_APPLY_ENABLED?.trim().toLowerCase() !== 'true'
  ) {
    throw new Error(
      'Apply mode is disabled. Set STORAGE_MIGRATION_APPLY_ENABLED=true after reviewing a dry-run.'
    )
  }

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
      bucket: r2Config.bucketName,
      includeFailed: options.includeFailed,
      recoverStale: options.recoverStale,
      sourceDeletion: false,
    })
  )

  let succeeded = 0
  let failed = 0
  let copiedObjects = 0
  let reusedObjects = 0
  let verifiedBytes = 0

  for (const photo of photos) {
    try {
      if (!options.apply) {
        const inspection = await inspectPhotoStorageMigration({
          photo,
          targetBucket: r2Config.bucketName,
          sourceAdapter,
          targetAdapter,
        })
        console.log(
          JSON.stringify({
            photoId: photo.id,
            result: 'dry-run-ready',
            objects: inspection.map((item) => ({
              key: item.plan.key,
              sourceBucket: item.source.bucket,
              bytes: item.sourceHead.sizeBytes,
              action: item.disposition,
            })),
          })
        )
        succeeded += 1
        continue
      }

      const copied = await copyPhotoStorageMigration({
        photo,
        targetBucket: r2Config.bucketName,
        sourceAdapter,
        targetAdapter,
        maxObjectBytes: options.maxObjectBytes,
      })
      copiedObjects += copied.copied
      reusedObjects += copied.reused

      await moveToVerifying(supabase, photo.id)

      const verified = await verifyPhotoStorageMigration({
        photo,
        targetBucket: r2Config.bucketName,
        sourceAdapter,
        targetAdapter,
      })
      verifiedBytes += verified.bytes

      const completion = buildPhotoStorageMigrationCompletion(
        photo,
        r2Config.bucketName,
        targetAdapter
      )
      await completeMigration({ supabase, photo, completion })

      console.log(
        JSON.stringify({
          photoId: photo.id,
          result: 'completed',
          copied: copied.copied,
          reused: copied.reused,
          verified: verified.verified,
          bytes: verified.bytes,
          sourceDeletion: false,
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
          sourceDeletion: false,
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
      copiedObjects,
      reusedObjects,
      verifiedBytes,
      sourceDeletion: false,
    })
  )

  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
