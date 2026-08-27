'use server'

import { updateTag } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { PORTFOLIO_CACHE_TAG } from '@/lib/portfolio-data'

/*
 * The public portfolio is cached for a minute. An owner who just saved an
 * edit is about to send someone the link, so they need the fresh copy now,
 * not on the next background pass — which is exactly what updateTag does
 * and revalidateTag's stale-while-revalidate does not.
 *
 * Signed in only: otherwise anyone could clear the cache in a loop.
 */
export async function refreshPortfolioCache() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return

  updateTag(PORTFOLIO_CACHE_TAG)
}
