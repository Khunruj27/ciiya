import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getUserStoragePlan } from '@/lib/get-user-storage-plan'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  createStorageRef,
  getStorageAdapter,
  getStorageAssetTarget,
  presetObjectKey,
} from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PRESET_BYTES = 2 * 1024 * 1024
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) throw new Error('Missing Supabase admin env')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(req: NextRequest) {
  let uploadedRef: ReturnType<typeof createStorageRef> | null = null
  let insertedAssetId: string | null = null

  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file')
    const albumIdValue = String(formData.get('albumId') || '').trim()
    const albumId = albumIdValue || null

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Missing preset file' },
        { status: 400 }
      )
    }

    if (
      !file.name.toLowerCase().endsWith('.xmp') ||
      file.size < 1 ||
      file.size > MAX_PRESET_BYTES
    ) {
      return NextResponse.json(
        { success: false, error: 'Choose an XMP file up to 2MB' },
        { status: 400 }
      )
    }

    if (albumId && !UUID_PATTERN.test(albumId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid album' },
        { status: 400 }
      )
    }

    if (albumId) {
      const { data: album } = await supabase
        .from('albums')
        .select('id, owner_id, user_id')
        .eq('id', albumId)
        .maybeSingle()

      if (
        !album ||
        (album.owner_id !== user.id && album.user_id !== user.id)
      ) {
        return NextResponse.json(
          { success: false, error: 'Album not found' },
          { status: 404 }
        )
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    if (buffer.length !== file.size || buffer.includes(0)) {
      return NextResponse.json(
        { success: false, error: 'Preset file is invalid' },
        { status: 400 }
      )
    }

    const plan = await getUserStoragePlan(user.id)
    if (buffer.length > plan.remainingBytes) {
      return NextResponse.json(
        {
          success: false,
          error: 'Storage full',
          code: 'STORAGE_LIMIT_EXCEEDED',
        },
        { status: 403 }
      )
    }

    const target = getStorageAssetTarget('preset', user.id)
    const path = presetObjectKey({
      ownerId: user.id,
      albumId,
      objectId: crypto.randomUUID(),
    })
    const ref = createStorageRef({ ...target, key: path })
    const adapter = getStorageAdapter(ref.provider)

    await adapter.uploadObject(ref, buffer, {
      contentType: 'application/xml',
      cacheControl: 'private, max-age=31536000, immutable',
      upsert: false,
    })
    uploadedRef = ref

    const supabaseAdmin = getSupabaseAdmin()
    const { data: asset, error: assetError } = await supabaseAdmin
      .from('storage_assets')
      .insert({
        owner_id: user.id,
        album_id: albumId,
        asset_kind: 'preset',
        storage_provider: ref.provider,
        storage_bucket: ref.bucket,
        object_key: ref.key,
        original_name: file.name.slice(0, 255),
        content_type: 'application/xml',
        size_bytes: buffer.length,
        status: 'active',
      })
      .select('id')
      .single()

    if (assetError || !asset) {
      throw new Error(assetError?.message || 'Unable to save preset metadata')
    }
    insertedAssetId = asset.id

    return NextResponse.json({
      success: true,
      assetId: asset.id,
      path,
      provider: ref.provider,
      bucket: ref.bucket,
      name: file.name.replace(/\.xmp$/i, ''),
    })
  } catch (error) {
    console.error('[presets/upload] failed:', error)

    if (uploadedRef) {
      await getStorageAdapter(uploadedRef.provider)
        .deleteObject(uploadedRef)
        .catch(() => {})
    }
    if (insertedAssetId) {
      try {
        await getSupabaseAdmin()
          .from('storage_assets')
          .delete()
          .eq('id', insertedAssetId)
      } catch {}
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Upload preset failed',
      },
      { status: 500 }
    )
  }
}
