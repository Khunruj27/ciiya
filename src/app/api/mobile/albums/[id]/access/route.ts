import bcrypt from 'bcryptjs'
import type { NextRequest } from 'next/server'
import {
  ALBUM_ACCESS_COLUMNS,
  albumAccessJson,
  albumAccessRevision,
  albumAccessSettings,
  hasValidAlbumPasswordHash,
  isAlbumAccessId,
  readAlbumAccessInput,
  readAlbumAccessRow,
} from '@/lib/mobile/album-access'
import { createMobileSupabaseClient } from '@/lib/mobile/server-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

async function readOwnedAccess(req: NextRequest, { params }: RouteParams) {
  // Explicit null prevents ambient/browser-cookie fallback for native calls.
  const supabase = await createMobileSupabaseClient(req.headers.get('authorization'))
  if (!supabase) return { response: albumAccessJson({ error: 'Unauthorized' }, 401) }

  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth?.user || !isAlbumAccessId(auth.user.id)) {
    return { response: albumAccessJson({ error: 'Unauthorized' }, 401) }
  }
  const { id } = await params
  if (!isAlbumAccessId(id)) return { response: albumAccessJson({ error: 'Album not found' }, 404) }
  const albumId = id.toLowerCase()
  const { data, error } = await supabase
    .from('albums')
    .select(ALBUM_ACCESS_COLUMNS)
    .eq('id', albumId)
    .eq('owner_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (error) return { response: albumAccessJson({ error: 'Unable to read album settings' }, 500) }
  if (!data) return { response: albumAccessJson({ error: 'Album not found' }, 404) }
  const row = readAlbumAccessRow(data, albumId)
  if (!row) return { response: albumAccessJson({ error: 'Unable to read album settings' }, 500) }
  return { supabase, ownerId: auth.user.id, row }
}

export async function GET(req: NextRequest, context: RouteParams) {
  try {
    const owned = await readOwnedAccess(req, context)
    if ('response' in owned) return owned.response
    return albumAccessJson({ settings: albumAccessSettings(owned.row) })
  } catch {
    return albumAccessJson({ error: 'Unable to read album settings' }, 500)
  }
}

export async function PATCH(req: NextRequest, context: RouteParams) {
  try {
    // Ownership and UUIDs are verified before reading the private request body.
    const owned = await readOwnedAccess(req, context)
    if ('response' in owned) return owned.response
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return albumAccessJson({ error: 'Invalid album settings' }, 400)
    }
    const input = readAlbumAccessInput(body)
    if (!input) return albumAccessJson({ error: 'Invalid album settings' }, 400)
    if (input.revision !== albumAccessRevision(owned.row)) {
      return albumAccessJson({ error: 'Album settings changed. Refresh and review again.' }, 409)
    }

    if (input.isPasswordProtected && !input.password && (
      owned.row.is_password_protected !== true ||
      !hasValidAlbumPasswordHash(owned.row.password_hash)
    )) {
      return albumAccessJson({ error: 'A new password is required to enable protection' }, 400)
    }
    const passwordHash = !input.isPasswordProtected ? null
      : input.password ? await bcrypt.hash(input.password, 10) : owned.row.password_hash
    if (passwordHash !== null && !hasValidAlbumPasswordHash(passwordHash)) {
      return albumAccessJson({ error: 'Unable to save album settings' }, 500)
    }

    const payload = {
      allow_download: input.allowDownload,
      allow_original_download: input.allowDownload && input.downloadSize === 'original',
      download_size: input.downloadSize,
      is_password_protected: input.isPasswordProtected,
      password_hash: passwordHash,
    }
    let query = owned.supabase.from('albums')
      .update(payload)
      .eq('id', owned.row.id)
      .eq('owner_id', owned.ownerId)
      .eq('status', 'active')

    // Compare the exact raw read values, not normalized display defaults. This
    // also fences a password change while bcrypt or another request is pending.
    for (const field of [
      'allow_download', 'allow_original_download', 'download_size',
      'is_password_protected', 'password_hash',
    ] as const) {
      const value = owned.row[field]
      query = value === null ? query.is(field, null) : query.eq(field, value)
    }
    const { data: updated, error } = await query.select('id').maybeSingle()
    if (error) return albumAccessJson({ error: 'Unable to save album settings' }, 500)
    if (updated?.id !== owned.row.id) {
      return albumAccessJson({ error: 'Album settings changed. Refresh and review again.' }, 409)
    }
    return albumAccessJson({ success: true })
  } catch {
    // Never expose/log private passwords, hashes, identities or database errors.
    return albumAccessJson({ error: 'Unable to save album settings' }, 500)
  }
}
