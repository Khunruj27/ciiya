import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  createStorageRef,
  getStorageAdapter,
  isOwnedPortfolioObjectKey,
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

function legacySupabasePortfolioKey(url: string, ownerId: string) {
  const marker = '/storage/v1/object/public/albums/'

  try {
    const pathname = new URL(url).pathname
    const index = pathname.indexOf(marker)
    if (index < 0) return null

    const key = decodeURIComponent(pathname.slice(index + marker.length))
    return isOwnedPortfolioObjectKey(key, ownerId) ? key : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const assetIds: string[] = Array.isArray(body?.assetIds)
    ? [...new Set<string>(body.assetIds.map((value: unknown) => String(value || '').trim()))]
        .filter(Boolean)
        .slice(0, 30)
    : []
  const legacyUrls: string[] = Array.isArray(body?.legacyUrls)
    ? [...new Set<string>(body.legacyUrls.map((value: unknown) => String(value || '').trim()))]
        .filter(Boolean)
        .slice(0, 30)
    : []

  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('hero_photo_url, gallery_urls, storage_asset_ids')
    .eq('user_id', user.id)
    .maybeSingle()

  const referencedIds = new Set<string>(portfolio?.storage_asset_ids || [])
  const referencedUrls = new Set<string>(
    [portfolio?.hero_photo_url, ...(portfolio?.gallery_urls || [])].filter(
      (value): value is string => Boolean(value)
    )
  )
  const deletableIds = assetIds.filter((id) => !referencedIds.has(id))
  const deletableLegacyUrls = legacyUrls.filter((url) => !referencedUrls.has(url))
  const supabaseAdmin = getSupabaseAdmin()

  const { data: assets, error: assetError } = deletableIds.length
    ? await supabaseAdmin
        .from('storage_assets')
        .select('id, storage_provider, storage_bucket, object_key')
        .eq('owner_id', user.id)
        .eq('asset_kind', 'portfolio')
        .in('id', deletableIds)
    : { data: [], error: null }

  if (assetError) {
    return NextResponse.json({ error: assetError.message }, { status: 500 })
  }

  const failed: Array<{ id?: string; url?: string; error: string }> = []
  const deletedIds: string[] = []

  for (const asset of assets || []) {
    if (!isOwnedPortfolioObjectKey(asset.object_key, user.id)) {
      failed.push({ id: asset.id, error: 'Invalid Portfolio object key' })
      continue
    }

    try {
      const provider = asset.storage_provider as StorageProvider
      await getStorageAdapter(provider).deleteObject(
        createStorageRef({
          provider,
          bucket: asset.storage_bucket,
          key: asset.object_key,
        })
      )
      deletedIds.push(asset.id)
    } catch (error) {
      failed.push({
        id: asset.id,
        error: error instanceof Error ? error.message : 'Delete failed',
      })
    }
  }

  if (deletedIds.length > 0) {
    await supabaseAdmin
      .from('storage_assets')
      .delete()
      .eq('owner_id', user.id)
      .in('id', deletedIds)
  }

  const legacyKeys = deletableLegacyUrls
    .map((url) => ({ url, key: legacySupabasePortfolioKey(url, user.id) }))
    .filter((item): item is { url: string; key: string } => Boolean(item.key))

  if (legacyKeys.length > 0) {
    const adapter = getStorageAdapter('supabase')
    const result = await adapter.deleteObjects(
      legacyKeys.map(({ key }) =>
        createStorageRef({ provider: 'supabase', bucket: 'albums', key })
      )
    )

    for (const item of result.failed) {
      const match = legacyKeys.find(({ key }) => key === item.ref.key)
      failed.push({ url: match?.url, error: item.error })
    }
  }

  return NextResponse.json(
    {
      success: failed.length === 0,
      deletedAssetIds: deletedIds,
      failed,
    },
    {
      status: failed.length > 0 ? 207 : 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  )
}
