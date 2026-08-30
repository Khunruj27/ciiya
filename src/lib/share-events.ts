import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type ShareEventType =
  | 'album_view'
  | 'photo_download'
  | 'photo_like'
  | 'moment_created'
  | 'moment_like'
  | 'face_search'

type ShareEventInput = {
  albumId: string
  ownerId: string | null | undefined
  eventType: ShareEventType
  photoId?: string | null
  guestKeyHash?: string | null
  metadata?: Record<string, string | number | boolean | null>
}

export function getShareEventsAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) throw new Error('Missing Supabase env')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Analytics must never break the visitor's primary action. A deployment can
 * also receive traffic while the migration is still rolling out, so event
 * writes are intentionally best-effort and logged only on the server.
 */
export async function recordShareEvent(
  supabase: SupabaseClient,
  input: ShareEventInput
) {
  if (!input.albumId || !input.ownerId) return

  const { error } = await supabase.from('share_events').insert({
    album_id: input.albumId,
    owner_id: input.ownerId,
    photo_id: input.photoId || null,
    event_type: input.eventType,
    guest_key_hash: input.guestKeyHash || null,
    metadata: input.metadata || {},
  })

  if (error) {
    console.warn('[share-events] unable to record event:', error.message)
  }
}
