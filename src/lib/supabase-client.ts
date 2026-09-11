import { getSupabaseBrowserClient } from '@/lib/supabase-browser'

// Kept for the many components that import { createClient } from here. It now
// returns the shared singleton so mounting several of them no longer spins up a
// new GoTrue client each time (which logged "Multiple GoTrue Client instances").
export function createClient() {
  return getSupabaseBrowserClient()
}
