'use client'

import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Wrap the factory calls so the singletons take the concrete client type these
// calls infer, rather than `ReturnType<typeof createBrowserClient>` (the
// generic factory), which resolves to under-typed queries/callbacks.
function makeBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function makeRealtimeClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: 'ciiya-realtime',
      },
    }
  )
}

let client: ReturnType<typeof makeBrowserClient> | null = null

// The one authed, cookie-session browser client. Every client component shares
// this instance so the app only ever holds a single GoTrue client under the
// default storage key (multiple instances on the same key log a warning and
// can behave oddly when used concurrently).
export function getSupabaseBrowserClient() {
  return (client ??= makeBrowserClient())
}

let realtimeClient: ReturnType<typeof makeRealtimeClient> | null = null

// A single anon, session-less client dedicated to public realtime
// subscriptions (share/album galleries). Its own storageKey keeps its GoTrue
// instance from colliding with the authed client above — that collision is
// what produced the "Multiple GoTrue Client instances detected … under the
// same storage key" warning.
export function getPublicRealtimeClient() {
  return (realtimeClient ??= makeRealtimeClient())
}
