import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { Portfolio, PortfolioAlbum, PortfolioView } from '@/lib/portfolio-types'

export type { Portfolio, PortfolioAlbum, PortfolioView }

// Public portfolio reads never touch a visitor's cookie, so they can live
// inside unstable_cache the way the share page's queries do.
function getAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

const PORTFOLIO_CACHE_TTL_SECONDS = 60
export const PORTFOLIO_CACHE_TAG = 'portfolios'

/* A Portfolio is intentionally independent from Albums. Only images uploaded
 * in the Portfolio editor may appear on the public page. */
function collectWork(portfolio: Portfolio): PortfolioView {
  return {
    portfolio,
    albums: [],
    totalPhotos: 0,
    totalViews: 0,
    showcase: (portfolio.gallery_urls ?? []).filter(Boolean),
  }
}

/* Everything a published portfolio renders, cached for a minute. */
export const getPortfolioBySlug = unstable_cache(
  async (slug: string): Promise<PortfolioView | null> => {
    const supabase = getAnonClient()

    const { data: portfolio, error } = await supabase
      .from('portfolios')
      .select('*')
      .eq('slug', slug.toLowerCase())
      .eq('is_published', true)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!portfolio) return null

    return collectWork(portfolio as Portfolio)
  },
  ['portfolio-by-slug'],
  {
    revalidate: PORTFOLIO_CACHE_TTL_SECONDS,
    // Saving from the editor busts this immediately, so an owner never
    // sends a client a link that shows the previous version.
    tags: [PORTFOLIO_CACHE_TAG],
  }
)

/*
 * The same page, rendered for the owner before they publish. Uncached and
 * cookie-scoped: RLS lets a signed-in user read only their own row, so an
 * unpublished portfolio stays invisible to everyone else even with the
 * preview flag in hand.
 */
export async function getOwnPortfolioPreview(
  slug: string
): Promise<PortfolioView | null> {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('*')
    .eq('slug', slug.toLowerCase())
    .eq('user_id', user.id)
    .maybeSingle()

  if (!portfolio) return null

  return collectWork(portfolio as Portfolio)
}

/*
 * Every portfolio starts life as ciiya + a number — a clean, brandable
 * default the owner can keep or rename. The digits are random rather than
 * sequential so one owner can't read another's count off their own URL,
 * and collisions are handled by simply trying another number.
 */
export function ciiyaSlugCandidate() {
  const digits = String(Math.floor(10000 + Math.random() * 90000))
  return `ciiya${digits}`
}
