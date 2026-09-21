import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  createStorageRef,
  getStorageAdapter,
  getStorageAssetTarget,
  portfolioImageKey,
} from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PORTFOLIO_IMAGE_BYTES = 15 * 1024 * 1024
const SIGNED_UPLOAD_EXPIRES_SECONDS = 15 * 60

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) throw new Error('Missing Supabase admin env')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return json({ error: 'Unauthorized' }, 401)

  const body = await request.json().catch(() => null)
  const contentType = String(body?.contentType || '').trim().toLowerCase()
  const fileName = String(body?.fileName || 'portfolio.jpg').trim().slice(0, 255)
  const fileSizeBytes = Number(body?.fileSizeBytes)

  if (
    contentType !== 'image/jpeg' ||
    !Number.isSafeInteger(fileSizeBytes) ||
    fileSizeBytes < 1 ||
    fileSizeBytes > MAX_PORTFOLIO_IMAGE_BYTES
  ) {
    return json({ error: 'Invalid Portfolio image' }, 400)
  }

  const plan = await getUserStoragePlan(user.id)

  if (fileSizeBytes > plan.remainingBytes) {
    return json(
      {
        error: 'Storage full',
        code: 'STORAGE_LIMIT_EXCEEDED',
        remainingBytes: plan.remainingBytes,
      },
      403
    )
  }

  const target = getStorageAssetTarget('portfolio', user.id)
  const key = portfolioImageKey({
    ownerId: user.id,
    objectId: crypto.randomUUID(),
  })
  const ref = createStorageRef({ ...target, key })
  const supabaseAdmin = getSupabaseAdmin()
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

  const { data: asset, error: assetError } = await supabaseAdmin
    .from('storage_assets')
    .insert({
      owner_id: user.id,
      asset_kind: 'portfolio',
      storage_provider: ref.provider,
      storage_bucket: ref.bucket,
      object_key: ref.key,
      original_name: fileName || 'portfolio.jpg',
      content_type: contentType,
      size_bytes: fileSizeBytes,
      status: 'uploading',
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (assetError || !asset) {
    console.error('[portfolio/assets/upload-url] reservation failed:', assetError)
    return json({ error: 'Unable to reserve Portfolio storage' }, 500)
  }

  try {
    const upload = await getStorageAdapter(ref.provider).getSignedUploadUrl(
      ref,
      {
        contentType,
        contentLength: fileSizeBytes,
        cacheControl: 'public, max-age=31536000, immutable',
        expiresInSeconds: SIGNED_UPLOAD_EXPIRES_SECONDS,
      }
    )

    return json({
      success: true,
      assetId: asset.id,
      provider: ref.provider,
      bucket: ref.bucket,
      key: ref.key,
      upload: {
        url: upload.url,
        method: upload.method,
        headers: upload.headers,
        expiresAt: upload.expiresAt?.toISOString() || null,
      },
    })
  } catch (error) {
    await supabaseAdmin.from('storage_assets').delete().eq('id', asset.id)
    console.error('[portfolio/assets/upload-url] signing failed:', error)
    return json({ error: 'Unable to prepare Portfolio upload' }, 500)
  }
}
