import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUnreadNotificationCount } from '@/lib/notifications'
import { getServerDictionary } from '@/lib/i18n-server'
import LanguageToggle from '@/components/language-toggle'
import AppIcon from '@/components/app-icon'
import { formatBytes, clampPercent } from '@/lib/format-bytes'
import { PLAN_LIMITS } from '@/lib/plans'
import BillingPortalButton from '@/components/billing-portal-button'
import NotificationBell from '@/components/notification-bell'
import {
  BellRing,
  ChevronRight,
  Info,
  LifeBuoy,
  Sparkles,
  Star,
  UserPlus,
} from 'lucide-react'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function MePage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { locale, t } = await getServerDictionary()
  const unreadNotificationCount = await getUnreadNotificationCount(supabase, user.id)

  const { count: albumCount } = await supabase
    .from('albums')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)

  const { count: photoCount } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)

  const { data: albumActivity } = await supabase
    .from('albums')
    .select('view_count,share_count')
    .eq('owner_id', user.id)

  const { data: storageUsage } = await supabase
    .from('user_storage_usage')
    .select(`
  current_plan,
  storage_used_bytes,
  used_bytes,
  storage_limit_bytes,
  photo_count,
  photos_count,
  albums_count
`)
    .eq('user_id', user.id)
    .maybeSingle()

  const region = user.user_metadata?.region || ''
  const province = user.user_metadata?.province || ''

    function normalizePlanKey(value?: string | null): keyof typeof PLAN_LIMITS {
  const plan = String(value || '').toLowerCase().trim()

  if (plan === 'starter' || plan === '20gb') return 'starter'
  if (plan === 'pro' || plan === 'pro-50gb' || plan === '50gb') return 'pro'
  if (plan === 'business' || plan === 'pro-100gb' || plan === '100gb') {
    return 'business'
  }

  return 'free'
}

const storagePlanKey = normalizePlanKey(storageUsage?.current_plan || 'free')

const totalBytes = Number(
  storageUsage?.storage_used_bytes ||
    storageUsage?.used_bytes ||
    0
)

const storageLimitBytes = Number(
  storageUsage?.storage_limit_bytes ||
    PLAN_LIMITS[storagePlanKey].storageBytes ||
    PLAN_LIMITS.free.storageBytes
)

  const usagePercent = clampPercent(
    storageLimitBytes > 0 ? (totalBytes / storageLimitBytes) * 100 : 0
  )

  const totalViews = (albumActivity || []).reduce(
    (sum, album) => sum + Number(album.view_count || 0),
    0
  )

  const totalShares = (albumActivity || []).reduce(
    (sum, album) => sum + Number(album.share_count || 0),
    0
  )

  // The meter now sits on the ink storage card, so it needs colours that
  // read against dark rather than the near-black it used to use on white.
  const barColor =
    usagePercent >= 90
      ? 'bg-red-400'
      : usagePercent >= 70
        ? 'bg-amber-400'
        : 'bg-gold'

  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    t.me.defaultName

  const avatarUrl =
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture ||
    null

  async function signOutAction() {
    'use server'

    const supabase = await createServerSupabaseClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  return (
    <main className="min-h-screen bg-ground px-5 pt-[max(32px,env(safe-area-inset-top))] pb-[max(120px,calc(env(safe-area-inset-bottom)+40px))] text-ink sm:px-8 lg:px-12">
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="px-1 text-[32px] font-bold leading-none tracking-[-0.045em]">
          {t.me.title}
        </h1>

        {/*
          The profile reads as a row rather than the centred portrait block it
          was: the name and address matter more than a 112px avatar, and the
          row leaves the storage card below as the screen's one focal point.
        */}
        <Link
          href="/me/edit"
          className="mt-5 flex items-center gap-4 rounded-panel border border-line bg-surface p-3 transition active:scale-[0.99]"
        >
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-ground-sunken">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                fill
                sizes="56px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[20px] font-semibold text-muted">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold tracking-[-0.02em]">
              {displayName}
            </p>
            <p className="mt-0.5 truncate text-[13px] font-normal text-muted">
              {user.email}
            </p>
            {province || region ? (
              <p className="mt-0.5 truncate text-[12px] font-normal text-muted/80">
                {province}
                {province && region ? ' • ' : ''}
                {region}
              </p>
            ) : null}
          </div>

          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>

        {/*
          Four figures on one surface separated by hairlines. As four saturated
          cards — pink, lime, cream, blue — they read as four unrelated things
          competing for the same glance, when they are just four counts.
        */}
        <section className="mt-3 grid grid-cols-4 divide-x divide-line rounded-panel border border-line bg-surface py-3">
          {[
            [t.me.jobs, albumCount || 0],
            [t.me.photos, photoCount || 0],
            [t.me.views, totalViews],
            [t.me.shares, totalShares],
          ].map(([label, value]) => (
            <div key={String(label)} className="px-1 text-center">
              <p className="text-[20px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
                {value}
              </p>
              <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
                {label}
              </p>
            </div>
          ))}
        </section>

        {/* Storage is the one thing on this screen with a limit worth watching,
            so it gets the dark card and everything else stays quiet. */}
        <section className="mt-3 rounded-hero bg-ink p-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                {t.me.storage}
              </p>
              <p className="mt-2 text-[26px] font-bold leading-none tracking-[-0.045em] tabular-nums">
                {formatBytes(totalBytes)}
                <span className="text-[14px] font-normal text-white/45">
                  {' '}/ {formatBytes(storageLimitBytes)}
                </span>
              </p>
            </div>

            <span className="shrink-0 rounded-full border border-gold/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-gold">
              {PLAN_LIMITS[storagePlanKey].name}
            </span>
          </div>

          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/12">
            <div
              className={`${barColor} h-full rounded-full transition-all duration-500`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>

          <div className="mt-2.5 flex items-center justify-between text-[11px] font-normal text-white/45 tabular-nums">
            <span>{t.me.used} {Math.round(usagePercent)}%</span>
            <span>
              {t.me.left} {formatBytes(Math.max(0, storageLimitBytes - totalBytes))}
            </span>
          </div>
        </section>

        <Link
          href="/pricing"
          className="mt-3 flex items-center gap-3 rounded-panel border border-gold/30 bg-gold-soft px-4 py-3.5 transition active:scale-[0.99]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-gold">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 3 14.2 8.6 20 9.3l-4.2 4 1.1 5.7L12 16.3 7.1 19l1.1-5.7-4.2-4 5.8-.7z" />
            </svg>
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-ink">
              {t.me.upgrade}
            </span>
            <span className="block text-[12px] font-normal text-gold-deep">
              {t.me.upgradeSub}
            </span>
          </span>

          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-gold-deep">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>

        <div className="mt-3">
          <BillingPortalButton />
        </div>

        {/* LANGUAGE */}
        <LanguageToggle current={locale} />

        {/* SUPPORT AND COMMUNITY */}
        <section className="mt-3 overflow-hidden rounded-panel border border-line bg-surface px-4">
          {[
            {
              label: t.me.helpCenter,
              href: `mailto:support@ciiya.app?subject=${encodeURIComponent(
                locale === 'th' ? 'ขอความช่วยเหลือเกี่ยวกับ Ciiya' : 'Ciiya support request'
              )}`,
              icon: LifeBuoy,
              external: true,
            },
            {
              label: t.me.inviteFriend,
              href: `mailto:?subject=${encodeURIComponent(
                locale === 'th' ? 'ลองใช้ Ciiya' : 'Try Ciiya'
              )}&body=${encodeURIComponent(
                locale === 'th'
                  ? 'ลองใช้ Ciiya สำหรับจัดเก็บและส่งมอบแกลเลอรีรูปภาพ https://ciiya.app'
                  : 'Try Ciiya for beautiful photo gallery delivery: https://ciiya.app'
              )}`,
              icon: UserPlus,
              external: true,
            },
            {
              label: t.me.writeReview,
              href: `mailto:support@ciiya.app?subject=${encodeURIComponent(
                locale === 'th' ? 'รีวิวการใช้งาน Ciiya' : 'My Ciiya review'
              )}`,
              icon: Star,
              external: true,
            },
            {
              label: t.me.followUpdates,
              href: '/notifications',
              icon: BellRing,
              external: false,
            },
            {
              label: t.me.aboutCiiya,
              href: '/#experience',
              icon: Info,
              external: false,
            },
          ].map(({ label, href, icon: Icon, external }, index, items) => (
            <div key={label}>
              <a
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer' : undefined}
                className="flex min-h-14 items-center gap-3 py-3 text-ink transition active:opacity-60"
              >
                <Icon className="h-5 w-5 shrink-0 text-muted" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 text-[14px] font-semibold tracking-[-0.015em]">
                  {label}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted/60" strokeWidth={1.75} />
              </a>
              {index < items.length - 1 ? <div className="ml-8 h-px bg-line" /> : null}
            </div>
          ))}
        </section>

        <section className="mt-3 flex min-h-14 items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3">
          <Sparkles className="h-5 w-5 shrink-0 text-muted" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 text-[14px] font-semibold text-ink">
            {t.me.version}
          </span>
          <span className="text-[13px] font-medium tabular-nums text-muted">23.1</span>
        </section>

        {/* SIGN OUT */}
        <form action={signOutAction} className="mt-7">
          <button
            type="submit"
            className="flex h-12 w-full items-center justify-center rounded-full border border-line bg-surface text-[14px] font-semibold text-red-600 transition active:scale-[0.99]"
          >
            {t.common.signOut}
          </button>
        </form>

      </div>

      {/* BOTTOM NAV */}
      <nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-2 rounded-[18px] border border-line bg-surface/95 px-2 py-2 shadow-lift backdrop-blur-xl sm:gap-3">
          <Link href="/albums" className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95">
            <AppIcon name="album" size={24} />
          </Link>

          <Link href="/portfolio" className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95">
            <AppIcon name="magic-wand" size={21} />
          </Link>

          <NotificationBell userId={user.id} initialCount={unreadNotificationCount} />

          <Link href="/me" className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-soft text-gold-deep">
            <AppIcon name="user" size={17} />
          </Link>
        </div>
      </nav>
    </main>
  )
}
