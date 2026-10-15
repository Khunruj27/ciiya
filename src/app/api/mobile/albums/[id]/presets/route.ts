import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'
import {
  MAX_LISTED_PRESETS,
  albumPresetJson,
  cleanPresetName,
  isAlbumPresetId,
  isUsablePresetPath,
  readPresetUpload,
  type MobileAlbumPreset,
} from '@/lib/mobile/album-presets'
import { createMobileSupabaseClient } from '@/lib/mobile/server-client'
import { rateLimit } from '@/lib/rate-limit'
import {
  createStorageRef,
  getStorageAdapter,
  getStorageAssetTarget,
  presetObjectKey,
} from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/** Verified owner and active album, using the user's own client under RLS. */
async function ownedAlbum(req: NextRequest, { params }: RouteParams) {
  // Explicit null prevents ambient/browser-cookie fallback for native calls.
  const supabase = await createMobileSupabaseClient(req.headers.get('authorization'))
  if (!supabase) return { response: albumPresetJson({ error: 'Unauthorized' }, 401) }

  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth?.user || !isAlbumPresetId(auth.user.id)) {
    return { response: albumPresetJson({ error: 'Unauthorized' }, 401) }
  }
  const { id } = await params
  if (!isAlbumPresetId(id)) return { response: albumPresetJson({ error: 'Album not found' }, 404) }
  const albumId = id.toLowerCase()

  const { data: album, error } = await supabase
    .from('albums')
    .select('id')
    .eq('id', albumId)
    .eq('owner_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (error) return { response: albumPresetJson({ error: 'Unable to load presets' }, 500) }
  if (album?.id !== albumId) return { response: albumPresetJson({ error: 'Album not found' }, 404) }

  return { supabase, ownerId: auth.user.id, albumId }
}

/** Presets this album's uploads may use: its own, then account-wide legacy ones. */
export async function GET(req: NextRequest, context: RouteParams) {
  try {
    const owned = await ownedAlbum(req, context)
    if ('response' in owned) return owned.response
    const { supabase, ownerId, albumId } = owned

    const { data: assets, error } = await supabase
      .from('storage_assets')
      .select('object_key,original_name,created_at')
      .eq('owner_id', ownerId)
      .eq('asset_kind', 'preset')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(MAX_LISTED_PRESETS)
    if (error) return albumPresetJson({ error: 'Unable to load presets' }, 500)

    const seen = new Set<string>()
    const presets: MobileAlbumPreset[] = []
    for (const asset of assets ?? []) {
      const path = asset.object_key
      if (!isUsablePresetPath(path, ownerId, albumId) || seen.has(path)) continue
      seen.add(path)
      presets.push({
        path,
        name: cleanPresetName(String(asset.original_name || path)),
        createdAt: typeof asset.created_at === 'string' ? asset.created_at : null,
      })
    }

    // Presets from before storage_assets live in the private `presets` bucket,
    // as on the website's own preset list. They are account-wide.
    try {
      const legacy = await getStorageAdapter('supabase', { supabase }).listObjects?.({
        bucket: 'presets',
        prefix: `${ownerId}/presets`,
        limit: MAX_LISTED_PRESETS,
      })
      for (const item of legacy?.objects ?? []) {
        const path = item.ref.key
        if (!isUsablePresetPath(path, ownerId, albumId) || seen.has(path)) continue
        seen.add(path)
        presets.push({ path, name: cleanPresetName(path), createdAt: item.lastModified?.toISOString() ?? null })
      }
    } catch {
      // The legacy inventory is best effort; registered presets are still listed.
    }

    return albumPresetJson({ presets: presets.slice(0, MAX_LISTED_PRESETS) })
  } catch {
    return albumPresetJson({ error: 'Unable to load presets' }, 500)
  }
}

/** Stores one .xmp preset for this album, as the website's uploader does. */
export async function POST(req: NextRequest, context: RouteParams) {
  let uploadedRef: ReturnType<typeof createStorageRef> | null = null
  try {
    // Ownership is verified before reading the request body.
    const owned = await ownedAlbum(req, context)
    if ('response' in owned) return owned.response
    const { ownerId, albumId } = owned

    const rate = await rateLimit(req, {
      bucket: 'mobile-preset-upload',
      identifier: ownerId,
      limit: 30,
      windowSeconds: 10 * 60,
    })
    if (!rate.allowed) return albumPresetJson({ error: 'Too many uploads. Try again shortly.', code: 'RATE_LIMITED' }, 429)

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return albumPresetJson({ error: 'Choose an XMP preset up to 2 MB', code: 'INVALID_PRESET' }, 400)
    }
    const input = readPresetUpload(body)
    if (!input) return albumPresetJson({ error: 'Choose an XMP preset up to 2 MB', code: 'INVALID_PRESET' }, 400)

    const buffer = Buffer.from(input.content, 'utf8')
    const plan = await getUserStoragePlan(ownerId)
    if (buffer.length > plan.remainingBytes) {
      return albumPresetJson({ error: 'Storage full', code: 'STORAGE_LIMIT_EXCEEDED' }, 403)
    }

    const target = getStorageAssetTarget('preset', ownerId)
    const path = presetObjectKey({ ownerId, albumId, objectId: crypto.randomUUID() })
    const ref = createStorageRef({ ...target, key: path })
    await getStorageAdapter(ref.provider).uploadObject(ref, buffer, {
      contentType: 'application/xml',
      cacheControl: 'private, max-age=31536000, immutable',
      upsert: false,
    })
    uploadedRef = ref

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Missing server configuration')
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: asset, error: assetError } = await admin
      .from('storage_assets')
      .insert({
        owner_id: ownerId,
        album_id: albumId,
        asset_kind: 'preset',
        storage_provider: ref.provider,
        storage_bucket: ref.bucket,
        object_key: ref.key,
        original_name: input.fileName.slice(0, 255),
        content_type: 'application/xml',
        size_bytes: buffer.length,
        status: 'active',
      })
      .select('id,created_at')
      .single()
    if (assetError || !asset) throw new Error('Unable to save preset metadata')

    return albumPresetJson({
      preset: {
        path,
        name: cleanPresetName(input.fileName),
        createdAt: typeof asset.created_at === 'string' ? asset.created_at : null,
      },
    }, 201)
  } catch {
    // The object was stored but not registered: remove it so nothing is orphaned.
    if (uploadedRef) {
      await getStorageAdapter(uploadedRef.provider).deleteObject(uploadedRef).catch(() => {})
    }
    return albumPresetJson({ error: 'Unable to save preset' }, 500)
  }
}
