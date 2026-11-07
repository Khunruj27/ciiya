import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { headers } from 'next/headers'
import { readBearerAccessToken } from '@/lib/bearer-token'

/**
 * A user-scoped client exclusively for the authorized mobile API. Browser and Sync
 * authentication remain unchanged. Missing or malformed credentials cannot
 * fall back to a browser cookie; callers still validate the JWT with getUser.
 */
export async function createMobileSupabaseClient(
  authorization?: string | null
): Promise<SupabaseClient | null> {
  const accessToken = readBearerAccessToken(
    authorization === undefined
      ? (await headers()).get('authorization')
      : authorization
  )

  if (!accessToken) return null

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}
