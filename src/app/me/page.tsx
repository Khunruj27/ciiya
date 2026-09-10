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
import styles from './me.module.css'
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
    <main className={`${styles.page} min-h-screen bg-ground text-ink`}>
      <div className={styles.container}>
        <header className={styles.header}>
        <div>
        <p className={styles.eyebrow}>CIIYA / {locale === 'th' ? 'พื้นที่ของคุณ' : 'YOUR SPACE'}</p>
        <h1 className={styles.heading}>
          {t.me.title}
        </h1>
        </div>
        <Link href="/me/edit" className={styles.editLink}>
          {locale === 'th' ? 'แก้ไขโปรไฟล์' : 'Edit profile'}<ChevronRight size={15} aria-hidden />
        </Link>
        </header>

        <div className={styles.layout}>
        <div className={styles.overview}>
        <div className={styles.identity}>
        <Link
          href="/me/edit"
          className={styles.profile}
        >
          <div className={styles.avatar}>
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                fill
                sizes="76px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[20px] font-semibold text-muted">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className={styles.name}>
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

        <section className={styles.stats}>
          {[
            [t.me.jobs, albumCount || 0],
            [t.me.photos, photoCount || 0],
            [t.me.views, totalViews],
            [t.me.shares, totalShares],
          ].map(([label, value]) => (
            <div key={String(label)} className="px-1 text-center">
              <p className={styles.statValue} title={String(value)}>
                {new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))}
              </p>
              <p className="mt-1.5 text-[11px] font-medium text-muted">
                {label}
              </p>
            </div>
          ))}
        </section>
        </div>

        {/* Storage is the one thing on this screen with a limit worth watching,
            so it gets the dark card and everything else stays quiet. */}
        <section className={styles.storage}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-white/75">
                {t.me.storage}
              </p>
              <p className="mt-3 flex flex-wrap items-baseline gap-x-1 gap-y-2 text-[28px] font-medium leading-tight tabular-nums">
                {formatBytes(totalBytes)}
                <span className="text-[13px] font-normal text-white/65">
                  {' '}/ {formatBytes(storageLimitBytes)}
                </span>
              </p>
            </div>

            <span className="shrink-0 rounded-full border border-gold/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-gold">
              {PLAN_LIMITS[storagePlanKey].name}
            </span>
          </div>

          <div role="progressbar" aria-label={t.me.storage} aria-valuenow={Math.round(usagePercent)} aria-valuemin={0} aria-valuemax={100} className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/12">
            <div
              className={`${barColor} h-full rounded-full transition-all duration-500`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] font-normal text-white/65 tabular-nums">
            <span>{t.me.used} {Math.round(usagePercent)}%</span>
            <span>
              {t.me.left} {formatBytes(Math.max(0, storageLimitBytes - totalBytes))}
            </span>
          </div>

        <Link
          href="/pricing"
          className={styles.upgrade}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-gold">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 3 14.2 8.6 20 9.3l-4.2 4 1.1 5.7L12 16.3 7.1 19l1.1-5.7-4.2-4 5.8-.7z" />
            </svg>
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-white">
              {t.me.upgrade}
            </span>
            <span className="mt-1 block text-[12px] font-normal text-white/65">
              {t.me.upgradeSub}
            </span>
          </span>

          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-gold-deep">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
        </section>

        <div className="mt-3">
          <BillingPortalButton />
        </div>
        </div>

        <div className={styles.settings}>
        <h2 className={styles.sectionTitle}>{locale === 'th' ? 'การตั้งค่าและบริการ' : 'Settings & services'}</h2>
        {/* LANGUAGE */}
        <LanguageToggle current={locale} />

        {/* SUPPORT AND COMMUNITY */}
        <section className={`${styles.menu} mt-3 overflow-hidden rounded-panel border border-line bg-surface px-4`}>
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
                className={styles.menuLink}
              >
                <span className={styles.menuIcon}><Icon className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden /></span>
                <span className="min-w-0 flex-1 text-[14px] font-semibold tracking-[-0.015em]">
                  {label}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted/60" strokeWidth={1.75} />
              </a>
              {index < items.length - 1 ? <div className="ml-12 h-px bg-line" /> : null}
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
        <form action={signOutAction} className="mt-5">
          <button
            type="submit"
            className={styles.signOut}
          >
            {t.common.signOut}
          </button>
        </form>
        </div>
        </div>
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
