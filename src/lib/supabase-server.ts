import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { readBearerAccessToken } from '@/lib/bearer-token'

async function createCookieSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {}
        },
      },
    }
  )
}

/**
 * The signed-in user's Supabase client for the current request.
 *
 * Browsers authenticate with the session cookie. The native mobile app has no
 * cookie jar, so it sends the same user access token as
 * `Authorization: Bearer <jwt>`. That is an explicit credential: when present,
 * cookies are not consulted at all, so one request can never mix two
 * identities. The token grants nothing a session cookie does not — callers
 * still verify it with `supabase.auth.getUser()`, which validates it with
 * Supabase Auth, and every query runs under that user's row level security.
 */
export async function createServerSupabaseClient(): Promise<
  Awaited<ReturnType<typeof createCookieSupabaseClient>>
> {
  const accessToken = readBearerAccessToken(
    (await headers()).get('authorization')
  )

  if (accessToken) {
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

  return createCookieSupabaseClient()
}
