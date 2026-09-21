import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  createStorageRef,
  getStorageAdapter,
  isOwnedPortfolioObjectKey,
  toPortfolioStorageAsset,
  type StorageAssetRecord,
  type StorageProvider,
} from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) throw new Error('Missing Supabase admin env')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return json({ error: 'Unauthorized' }, 401)

  const body = await request.json().catch(() => null)
  const assetId = String(body?.assetId || '').trim()

  if (!assetId) return json({ error: 'Missing assetId' }, 400)

  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('storage_assets')
    .select('*')
    .eq('id', assetId)
    .eq('owner_id', user.id)
    .eq('asset_kind', 'portfolio')
    .maybeSingle()

  if (error || !data) return json({ error: 'Upload reservation not found' }, 404)

  const asset = data as StorageAssetRecord

  if (!isOwnedPortfolioObjectKey(asset.object_key, user.id)) {
    return json({ error: 'Invalid Portfolio object key' }, 400)
  }

  if (asset.status === 'active') {
    const result = toPortfolioStorageAsset(asset)
    return result
      ? json({ success: true, asset: result })
      : json({ error: 'Portfolio asset is incomplete' }, 409)
  }

  if (asset.status !== 'uploading') {
    return json({ error: 'Portfolio upload is not active' }, 409)
  }

  const ref = createStorageRef({
    provider: asset.storage_provider as StorageProvider,
    bucket: asset.storage_bucket,
    key: asset.object_key,
  })
  const adapter = getStorageAdapter(ref.provider)
  const head = await adapter.objectExists(ref)

  if (!head.exists || head.sizeBytes !== Number(asset.size_bytes)) {
    await supabaseAdmin
      .from('storage_assets')
      .update({ status: 'failed', expires_at: null })
      .eq('id', asset.id)

    if (head.exists) await adapter.deleteObject(ref).catch(() => {})

    return json({ error: 'Uploaded Portfolio image could not be verified' }, 400)
  }

  if (head.contentType && !head.contentType.toLowerCase().includes('image/jpeg')) {
    await adapter.deleteObject(ref).catch(() => {})
    await supabaseAdmin
      .from('storage_assets')
      .update({ status: 'failed', expires_at: null })
      .eq('id', asset.id)
    return json({ error: 'Uploaded object is not a JPEG image' }, 400)
  }

  const publicUrl = adapter.getPublicUrl(ref)

  if (!publicUrl) {
    return json({ error: 'Public delivery is not configured for this asset' }, 503)
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('storage_assets')
    .update({
      public_url: publicUrl,
      size_bytes: head.sizeBytes,
      content_type: head.contentType || 'image/jpeg',
      status: 'active',
      expires_at: null,
    })
    .eq('id', asset.id)
    .eq('status', 'uploading')
    .select('*')
    .single()

  if (updateError || !updated) {
    console.error('[portfolio/assets/finalize] update failed:', updateError)
    return json({ error: 'Unable to finalize Portfolio upload' }, 500)
  }

  const result = toPortfolioStorageAsset(updated as StorageAssetRecord)

  return result
    ? json({ success: true, asset: result })
    : json({ error: 'Portfolio asset metadata is invalid' }, 500)
}
