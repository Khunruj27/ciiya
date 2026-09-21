import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getStorageAdapter } from '@/lib/storage'

export const dynamic = 'force-dynamic'

function cleanPresetName(value: string) {
  return value
    .split('/')
    .pop()!
    .replace(/^\d+-/, '')
    .replace(/\.xmp$/i, '')
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: storedAssets, error: assetError } = await supabase
      .from('storage_assets')
      .select(
        'id, object_key, original_name, storage_provider, storage_bucket, created_at'
      )
      .eq('owner_id', user.id)
      .eq('asset_kind', 'preset')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(100)

    if (assetError) throw new Error(assetError.message)

    const seen = new Set<string>()
    const presets = (storedAssets || []).map((asset) => {
      seen.add(asset.object_key)
      return {
        id: asset.id as string | null,
        name: cleanPresetName(asset.original_name || asset.object_key),
        fileName: asset.original_name || asset.object_key.split('/').pop(),
        path: asset.object_key,
        provider: asset.storage_provider,
        bucket: asset.storage_bucket,
        createdAt: asset.created_at || null,
      }
    })

    // Existing presets were not registered in storage_assets. Keep listing
    // their private Supabase folder until the copy migration is complete.
    const legacyInventory = await getStorageAdapter('supabase', {
      supabase,
    }).listObjects?.({
      bucket: 'presets',
      prefix: `${user.id}/presets`,
      limit: 100,
    })

    for (const item of legacyInventory?.objects || []) {
      const path = item.ref.key
      const fileName = path.split('/').pop() || path
      if (!fileName.toLowerCase().endsWith('.xmp')) continue
      if (seen.has(path)) continue
      seen.add(path)
      presets.push({
        id: null,
        name: cleanPresetName(fileName),
        fileName,
        path,
        provider: 'supabase',
        bucket: 'presets',
        createdAt: item.lastModified?.toISOString() || null,
      })
    }

    return NextResponse.json({ success: true, presets })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'List presets failed',
      },
      { status: 500 }
    )
  }
}
