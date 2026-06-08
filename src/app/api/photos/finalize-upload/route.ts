import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {createClient, type SupabaseClient,} from '@supabase/supabase-js'
import { PLAN_LIMITS } from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RequestedSize = 'sd' | 'hd' | 'uhd' | 'original'

type PhotoRecord = {
  id: string
  album_id: string
  owner_id?: string | null
  user_id?: string | null

  filename?: string | null
  file_name?: string | null

  original_path?: string | null
  storage_path?: string | null

  preset_path?: string | null

  public_url?: string | null
  original_url?: string | null
  preview_url?: string | null
  thumbnail_url?: string | null

  processing_status?: string | null
}

type SupabaseAdminClient = SupabaseClient

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) return null

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function normalizeRequestedSize(value: string): RequestedSize {
  if (value === 'sd') return 'sd'
  if (value === 'uhd') return 'uhd'
  if (value === 'original') return 'original'
  return 'hd'
}

function normalizePlanKey(value?: string | null): keyof typeof PLAN_LIMITS {
  const plan = String(value || '').toLowerCase().trim()

  if (plan === 'starter' || plan === '20gb') return 'starter'
  if (plan === 'pro' || plan === 'pro-50gb' || plan === '50gb') return 'pro'
  if (
    plan === 'business' ||
    plan === 'pro-100gb' ||
    plan === '100gb'
  ) {
    return 'business'
  }

  return 'free'
}

function getPhotoJobPriority(params: {
  fileSizeBytes: number
  size: RequestedSize
  hasPreset: boolean
}) {
  const sizeMb = params.fileSizeBytes / 1024 / 1024
  let priority = 100

  if (params.size === 'sd') priority -= 15
  if (params.size === 'hd') priority -= 10
  if (params.size === 'uhd') priority += 10
  if (params.size === 'original') priority += 20

  if (sizeMb <= 5) priority -= 10
  if (sizeMb > 15) priority += 10
  if (sizeMb > 35) priority += 20
  if (sizeMb > 70) priority += 35
  if (params.hasPreset) priority += 5

  return Math.max(10, Math.min(200, Math.round(priority)))
}

async function ensurePhotoJob(params: {
  supabaseAdmin: SupabaseAdminClient,
  photo: PhotoRecord
  fallbackOriginalPath?: string | null
  presetPath?: string | null
  size: RequestedSize
  jobPriority: number
  fileHash?: string | null
  fileName?: string | null
  publicUrl?: string | null
  source: string
}) {
  const {
    supabaseAdmin,
    photo,
    fallbackOriginalPath,
    presetPath,
    size,
    jobPriority,
    fileHash,
    fileName,
    publicUrl,
    source,
  } = params

  const photoId = photo?.id
  const albumId = photo?.album_id
  const ownerId = photo?.owner_id || photo?.user_id || null
  const originalPath =
    photo?.original_path || photo?.storage_path || fallbackOriginalPath || null

  if (!photoId || !albumId || !ownerId || !originalPath) {
    return {
      queued: false,
      jobId: null,
      error: 'Missing photo_id, album_id, owner_id, or original_path',
    }
  }

  const { data: activeJob, error: activeJobError } = await supabaseAdmin
    .from('photo_jobs')
    .select('id,status')
    .eq('photo_id', photoId)
    .in('status', ['pending', 'processing'])
    .maybeSingle()

  if (activeJobError) {
    return {
      queued: false,
      jobId: null,
      error: activeJobError.message,
    }
  }

if (activeJob?.id) {
    return {
      queued: true,
      jobId: activeJob.id,
      error: null,
    }
  }

  const { data: insertedJob, error: insertJobError } = await supabaseAdmin
    .from('photo_jobs')
    .insert({
      photo_id: photoId,
      album_id: albumId,
      owner_id: ownerId,
      original_path: originalPath,
      preset_path: photo?.preset_path || presetPath || null,
      size,
      status: 'pending',
      priority: jobPriority,
      progress: 0,
      retry_count: 0,
      retries: 0,
      started_at: null,
      finished_at: null,
      error: null,
      payload: {
        source,
        fileHash,
        originalName: fileName || photo?.filename || photo?.file_name || null,
        publicUrl,
        requestedSize: size,
        presetPath: photo?.preset_path || presetPath || null,
        jobPriority,
      },
    })
    .select('id,status')
    .single()

  if (insertJobError) {
    return {
      queued: false,
      jobId: null,
      error: insertJobError.message,
    }
  }

  return {
  queued: true,
  jobId: insertedJob?.id || null,
  error: null,
}
}

async function safeRecalculateStorage(
  supabaseAdmin: SupabaseAdminClient,
  userId: string
) {
  try {
    await supabaseAdmin.rpc(
'recalculate_user_storage',
  {
    user_uuid: userId,
  }
)
  } catch (error) {
    console.warn('[finalize-upload] recalculate storage skipped:', error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const workerSecret = req.headers.get('x-worker-secret')
const isWorkerRequest =
  Boolean(process.env.WORKER_SECRET) &&
  workerSecret === process.env.WORKER_SECRET

    const {
  data: { user },
} = await supabase.auth.getUser()

if (!user && !isWorkerRequest) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

    const body = await req.json()

    const albumId = String(body.albumId || '').trim()
    const storagePath = String(body.storagePath || '').trim()
    const fileName = String(body.fileName || '').trim()
    const fileSizeBytes = Number(body.fileSizeBytes || 0)

    const fileHash =
  String(body.fileHash || '').trim() ||
  `${fileName}-${fileSizeBytes}-${storagePath}`
    const size = normalizeRequestedSize(String(body.size || 'hd').toLowerCase())
    const categoryId = body.categoryId || null
    const presetPath = body.presetPath ? String(body.presetPath).trim() : null

    if (
  !albumId ||
  !storagePath ||
  !fileName ||
  !Number.isFinite(fileSizeBytes) ||
  fileSizeBytes <= 0
) {
      return NextResponse.json(
        { error: 'Missing required upload data' },
        { status: 400 }
      )
    }

     const supabaseAdmin = getSupabaseAdmin()

    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Missing SUPABASE_SERVICE_ROLE_KEY' },
        { status: 500 }
      )
    }

    const { data: album, error: albumError } = await supabaseAdmin
  .from('albums')
  .select('id, owner_id, user_id, cover_url')
  .eq('id', albumId)
  .single()

    if (albumError || !album) {
  return NextResponse.json({ error: 'Album not found' }, { status: 404 })
}

if (!isWorkerRequest) {
  const canAccess =
    album.owner_id === user?.id ||
    album.user_id === user?.id

  if (!canAccess) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  }
}
    
    const ownerId =
  album.owner_id || album.user_id || user?.id || null

if (!ownerId) {
  return NextResponse.json(
    { error: 'Missing album owner' },
    { status: 500 }
  )
}

    const jobPriority = getPhotoJobPriority({
      fileSizeBytes,
      size,
      hasPreset: Boolean(presetPath),
    })

    const { data: publicUrlData } = supabaseAdmin.storage
      .from('albums')
      .getPublicUrl(storagePath)

    const publicUrl = publicUrlData.publicUrl

    const { data: existingPhoto, error: existingPhotoError } =
      await supabaseAdmin
        .from('photos')
        .select(
          `
          id,
          album_id,
          owner_id,
          user_id,
          filename,
          file_name,
          file_hash,
          public_url,
          original_url,
          preview_url,
          thumbnail_url,
          processing_status,
          original_path,
          storage_path,
          preset_path
        `
        )
        .eq('album_id', albumId)
        .eq('file_hash', fileHash)
        .maybeSingle()

    if (existingPhotoError) {
      return NextResponse.json(
        { error: existingPhotoError.message },
        { status: 500 }
      )
    }

    if (existingPhoto) {
      const needsRepair =
        !existingPhoto.preview_url ||
        !existingPhoto.thumbnail_url ||
        ['pending', 'processing', 'failed'].includes(
          String(existingPhoto.processing_status || '')
        )

      let queueResult: Awaited<ReturnType<typeof ensurePhotoJob>> | null = null

      if (needsRepair) {
        queueResult = await ensurePhotoJob({
          supabaseAdmin,
          photo: existingPhoto,
          fallbackOriginalPath: storagePath,
          presetPath,
          size,
          jobPriority,
          fileHash,
          fileName,
          publicUrl:
            existingPhoto.preview_url ||
            existingPhoto.public_url ||
            existingPhoto.original_url ||
            publicUrl,
          source: 'finalize-upload-duplicate-repair',
        })

        await supabaseAdmin
          .from('photos')
          .update({
            processing_status: queueResult.queued ? 'pending' : 'failed',
            processing_progress: 0,
            preset_path: existingPhoto.preset_path || presetPath || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingPhoto.id)
      }

      return NextResponse.json({
        success: true,
        duplicate: true,
        repaired: needsRepair,
        jobQueued: queueResult?.queued || false,
        jobId: queueResult?.jobId || null,
        jobError: queueResult?.error || null,
        photoId: existingPhoto.id,
        publicUrl:
          existingPhoto.preview_url ||
          existingPhoto.public_url ||
          existingPhoto.original_url ||
          publicUrl,
        thumbnailUrl: existingPhoto.thumbnail_url,
        processingStatus: needsRepair
          ? queueResult?.queued
            ? 'pending'
            : 'failed'
          : existingPhoto.processing_status || 'done',
        jobPriority,
      })
    }

    await safeRecalculateStorage(supabaseAdmin, ownerId)

    let { data: usage } = await supabaseAdmin
      .from('user_storage_usage')
      .select('*')
      .eq('user_id', ownerId)
      .maybeSingle()

    if (!usage) {
      const defaultPlan = 'free'
const defaultLimit = PLAN_LIMITS[defaultPlan].storageBytes

      await supabaseAdmin.from('user_storage_usage').upsert(
        {
          user_id: ownerId,
          current_plan: defaultPlan,
          used_bytes: 0,
          storage_used_bytes: 0,
          storage_limit_bytes: defaultLimit,
          photo_count: 0,
          photos_count: 0,
          albums_count: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id', ignoreDuplicates: true }
      )

      const { data: ensuredUsage, error: ensuredUsageError } =
        await supabaseAdmin
          .from('user_storage_usage')
          .select('*')
          .eq('user_id', ownerId)
          .single()

      if (ensuredUsageError || !ensuredUsage) {
        return NextResponse.json(
          {
            error:
              ensuredUsageError?.message ||
              'Cannot initialize storage usage',
          },
          { status: 500 }
        )
      }

      usage = ensuredUsage
    }

    const currentUsed = Number(
      usage.storage_used_bytes || usage.used_bytes || 0
    )

    const normalizedPlan = normalizePlanKey(usage.current_plan)

const currentLimit = Number(
  usage.storage_limit_bytes ||
    PLAN_LIMITS[normalizedPlan].storageBytes ||
    PLAN_LIMITS.free.storageBytes
)

    const estimatedUploadBytes =
      fileSizeBytes +
      Math.round(fileSizeBytes * 0.35) +
      Math.round(fileSizeBytes * 0.05)

   if (currentUsed + estimatedUploadBytes > currentLimit) {

  return NextResponse.json(
  {
    error: 'Storage full',
    code: 'STORAGE_LIMIT_EXCEEDED',
    plan: normalizedPlan,
    storageUsedBytes: currentUsed,
    storageLimitBytes: currentLimit,
    estimatedUploadBytes,
    remainingBytes: Math.max(0, currentLimit - currentUsed),
  },
  { status: 403 }
)
}

    const { data: insertedPhoto, error: insertError } = await supabaseAdmin
      .from('photos')
      .insert({
        album_id: albumId,
        owner_id: ownerId,
        user_id: ownerId,

        filename: fileName,
        file_name: fileName,
        file_hash: fileHash,

        storage_path: storagePath,
        original_path: storagePath,

        public_url: publicUrl,
        original_url: publicUrl,
        image_url: publicUrl,

        category_id: categoryId,
        preset_path: presetPath,
        selected_size: size,

        file_size_bytes: fileSizeBytes,
        original_size_bytes: fileSizeBytes,
        preview_size_bytes: 0,
        thumbnail_size_bytes: 0,

        preview_url: null,
        thumbnail_url: null,
        blur_data_url: null,

        processing_status: 'pending',
        processing_progress: 0,

        metadata: {
          uploadedVia: 'api/photos/finalize-upload',
          requestedSize: size,
          presetPath,
          jobPriority,
        },

        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (insertError || !insertedPhoto) {
      return NextResponse.json(
        { error: insertError?.message || 'Photo insert failed' },
        { status: 500 }
      )
    }

    const queueResult = await ensurePhotoJob({
      supabaseAdmin,
      photo: insertedPhoto,
      fallbackOriginalPath: storagePath,
      presetPath,
      size,
      jobPriority,
      fileHash,
      fileName,
      publicUrl,
      source: 'finalize-upload',
    })

    if (!queueResult.queued) {
      await supabaseAdmin
        .from('photos')
        .update({
          processing_status: 'failed',
          processing_progress: 0,
          updated_at: new Date().toISOString(),
          metadata: {
            uploadedVia: 'api/photos/finalize-upload',
            requestedSize: size,
            presetPath,
            jobPriority,
            queueError: queueResult.error,
          },
        })
        .eq('id', insertedPhoto.id)

      return NextResponse.json({
        success: true,
        duplicate: false,
        photoId: insertedPhoto.id,
        publicUrl,
        jobQueued: false,
        jobId: null,
        jobError: queueResult.error,
        processingStatus: 'failed',
        jobPriority,
      })
    }

    if (!album.cover_url && insertedPhoto.public_url) {
      await supabaseAdmin
        .from('albums')
        .update({
          cover_url: insertedPhoto.public_url,
          cover_photo_id: insertedPhoto.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', albumId)
    }

    await safeRecalculateStorage(supabaseAdmin, ownerId)

    return NextResponse.json({
      success: true,
      duplicate: false,
      photoId: insertedPhoto.id,
      publicUrl,
      jobQueued: true,
      jobId: queueResult.jobId,
      processingStatus: 'pending',
      jobPriority,
    })
  } catch (error) {
    console.error('Finalize upload error:', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Finalize upload failed',
      },
      { status: 500 }
    )
  }
}