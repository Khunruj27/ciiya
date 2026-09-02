import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { ciiyaSlugCandidate } from '@/lib/portfolio-data'
import AppIcon from '@/components/app-icon'
import PortfolioEditor from '@/components/portfolio-editor'
import NotificationBell from '@/components/notification-bell'
import { getUnreadNotificationCount } from '@/lib/notifications'
import { getServerDictionary } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

// The private editor (the public portfolio lives at /portfolio/<slug>).
export const metadata = {
  title: 'พอร์ตโฟลิโอของคุณ',
  robots: { index: false, follow: false },
}
export const revalidate = 0

export default async function PortfolioPage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { t } = await getServerDictionary()
  const unreadNotificationCount = await getUnreadNotificationCount(supabase, user.id)

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
          <h1 className="text-[22px] font-semibold">{t.portfolio.createFailed}</h1>
          <p className="mt-2 text-[14px] text-muted">
            {t.portfolio.tryReload}
          </p>
          <Link
            href="/portfolio"
            className="mt-5 inline-flex h-11 items-center rounded-full bg-ink px-6 text-[13px] font-semibold text-white"
          > 
            {t.portfolio.reload}
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
    <main className="min-h-screen bg-ground px-3 pt-[max(12px,env(safe-area-inset-top))] pb-[max(120px,calc(env(safe-area-inset-bottom)+40px))] text-ink sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1320px]">
        <header className="relative overflow-hidden rounded-panel border border-line bg-surface shadow-card">
          <div aria-hidden className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-gold-soft/70 blur-3xl" />
          <div className="relative flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <Link
                href="/albums"
                aria-label={t.portfolio.myJobs}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-ground text-[18px] text-ink transition hover:border-line-strong active:scale-95"
              >
                <span aria-hidden>←</span>
              </Link>
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-gold-deep">Ciiya Portfolio</p>
                <h1 className="mt-1 truncate text-[24px] font-semibold leading-tight tracking-[-0.04em] sm:text-[28px]">
                  พอร์ตโฟลิโอของคุณ
                </h1>
                <p className="mt-1 text-[11px] leading-relaxed text-muted sm:text-[12px]">
                  แก้ไขข้อมูล เลือกรูปแบบ แล้วบันทึกเพื่อส่งให้ลูกค้า
                </p>
              </div>
            </div>
            <span className="self-start rounded-full bg-ink px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-white sm:self-center">
              {t.portfolio.studio}
            </span>
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
            <AppIcon name="magic-wand" size={21} />
          </Link>

          <NotificationBell userId={user.id} initialCount={unreadNotificationCount} />

          <Link href="/me" className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95">
            <AppIcon name="user-1" size={17} />
          </Link>
        </div>
      </nav>
    </main>
  )
}
