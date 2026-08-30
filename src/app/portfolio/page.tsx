import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { ciiyaSlugCandidate } from '@/lib/portfolio-data'
import AppIcon from '@/components/app-icon'
import PortfolioEditor from '@/components/portfolio-editor'
import NotificationBell from '@/components/notification-bell'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PortfolioPage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const displayName =
    user.user_metadata?.full_name || user.user_metadata?.name || ''

  let { data: portfolio } = await supabase
    .from('portfolios')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  /*
   * The row is created on first visit rather than on first save, so the
   * editor always has a slug to show and the owner can see their public
   * URL before they have typed anything. It stays unpublished until they
   * say so, so creating it early exposes nothing.
   */
  if (!portfolio) {
    // ciiya + a random number, retried on the rare collision.
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data, error } = await supabase
        .from('portfolios')
        .insert({
          user_id: user.id,
          slug: ciiyaSlugCandidate(),
          display_name: displayName || null,
          location: user.user_metadata?.province || null,
          contact_email: user.email || null,
        })
        .select('*')
        .single()

      if (!error && data) {
        portfolio = data
        break
      }

      // 23505 is a taken slug — the only collision worth retrying.
      if (error && error.code !== '23505') {
        console.error('[portfolio] create failed:', error.message)
        break
      }
    }
  }

  if (!portfolio) {
    return (
      <main className="grid min-h-screen place-items-center bg-ground px-6 text-center text-ink">
        <div>
          <h1 className="text-[22px] font-semibold">Couldn’t create portfolio</h1>
          <p className="mt-2 text-[14px] text-muted">
            Try reloading this page
          </p>
          <Link
            href="/portfolio"
            className="mt-5 inline-flex h-11 items-center rounded-full bg-ink px-6 text-[13px] font-semibold text-white"
          >
            Reload
          </Link>
        </div>
      </main>
    )
  }

  const headerList = await headers()
  const host = headerList.get('x-forwarded-host') || headerList.get('host') || ''
  const proto =
    headerList.get('x-forwarded-proto') ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https')
  const origin = host ? `${proto}://${host}` : ''

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_85%_0%,rgba(199,168,107,0.16),transparent_28rem)] bg-ground px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(120px,calc(env(safe-area-inset-bottom)+40px))] text-ink sm:px-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1480px]">
        <header className="relative overflow-hidden rounded-hero border border-line bg-surface shadow-card">
          <div aria-hidden className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-gold-soft blur-3xl" />
          <div className="relative flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-8">
            <Link
              href="/albums"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[12px] font-semibold text-muted transition hover:text-ink active:scale-95"
            >
              <span aria-hidden>←</span>
              My Jobs
            </Link>
            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] font-medium text-muted sm:inline">Ciiya</span>
              <span className="rounded-full bg-ink px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">Portfolio Studio</span>
            </div>
          </div>

          <div className="relative grid gap-8 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end lg:gap-14 lg:px-12 lg:py-14">
            <div className="max-w-3xl">
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-gold-deep">Your portfolio page</p>
              <h1 className="mt-4 text-[clamp(2.45rem,6vw,5.4rem)] font-semibold leading-[0.9] tracking-[-0.065em]">
                Portfolio that stands out<br />from the first frame
              </h1>
              <p className="mt-6 max-w-xl text-[14px] font-normal leading-[1.8] text-muted sm:text-[16px]">
                Pick your photos, tell your story, and open a way to hire you — all on one page.
                Every edit shows in the preview before you send it to a client.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-panel border border-line bg-ground/75 p-3 sm:p-4">
              {[
                ['01', 'Details'],
                ['02', 'Design'],
                ['03', 'Publish'],
              ].map(([number, label]) => (
                <div key={number} className="rounded-card bg-surface px-3 py-4 text-center shadow-card">
                  <p className="text-[10px] font-semibold tracking-[0.14em] text-gold-deep">{number}</p>
                  <p className="mt-2 text-[11px] font-semibold text-ink sm:text-[12px]">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </header>

        <PortfolioEditor
          initial={portfolio}
          userId={user.id}
          origin={origin}
        />
      </div>

      {/* BOTTOM NAV */}
      <nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-2 rounded-[18px] border border-line bg-surface/95 px-2 py-2 shadow-lift backdrop-blur-xl sm:gap-3">
          <Link href="/albums" className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95">
            <AppIcon name="album" size={24} />
          </Link>

          <Link href="/portfolio" className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-soft text-gold-deep">
            <AppIcon name="gallery" size={21} />
          </Link>

          <Link href="/pricing" className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95">
            <AppIcon name="magic-wand" size={24} />
          </Link>

          <NotificationBell userId={user.id} />

          <Link href="/me" className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95">
            <AppIcon name="user-1" size={17} />
          </Link>
        </div>
      </nav>
    </main>
  )
}
