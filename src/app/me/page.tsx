import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AppIcon from '@/components/app-icon'
import { formatBytes, clampPercent } from '@/lib/format-bytes'
import { PLAN_LIMITS } from '@/lib/plans'
import BillingPortalButton from '@/components/billing-portal-button'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function MePage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { count: albumCount } = await supabase
    .from('albums')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)

  const { count: photoCount } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)

  const { data: latestAlbums } = await supabase
    .from('albums')
    .select('id,title,cover_url,created_at,view_count,share_count')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5)

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

  const totalViews = (latestAlbums || []).reduce(
    (sum, album) => sum + Number(album.view_count || 0),
    0
  )

  const totalShares = (latestAlbums || []).reduce(
    (sum, album) => sum + Number(album.share_count || 0),
    0
  )

  const barColor =
    usagePercent >= 90
      ? 'bg-red-500'
      : usagePercent >= 70
        ? 'bg-yellow-500'
        : 'bg-[#1C0617]'

  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    'User Name'

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
    <main className="min-h-screen bg-[#F9F9F9] px-5 pt-[max(60px,env(safe-area-inset-top))] pb-[max(120px,calc(env(safe-area-inset-bottom)+40px))] text-[#1C0617]">
      <div className="mx-auto w-full max-w-[390px]">
        {/* HEADER */}
        <section className="flex items-center justify-between px-1">
          <div>
            <h1 className="mt-1 text-[34px] font-black leading-none tracking-[-0.06em]">
              Account
            </h1>
          </div>
        </section>

        {/* PROFILE */}
        <Link
          href="/me/edit"
          className="mt-6 block rounded-[34px] border border-black/5 bg-white p-4"
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative h-28 w-28 overflow-hidden rounded-full bg-[#F2EEE9] ring-4 ring-[#FAF7F4]">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={displayName}
                  fill
                  sizes="112px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-4xl font-black text-[#B8AEB4]">
                  {displayName.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>

            <h2 className="mt-5 max-w-full truncate text-[30px] font-black leading-none tracking-[-0.06em]">
              {displayName}
            </h2>

            <p className="mt-2 max-w-full truncate text-[14px] font-semibold text-[#8E8E93]">
              {user.email}
            </p>

            {province || region ? (
              <p className="mt-2 text-[13px] font-semibold text-[#A0969B]">
                {province}
                {province && region ? ' • ' : ''}
                {region}
              </p>
            ) : null}
          </div>
        </Link>

        {/* OVERVIEW */}
        <section className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-[26px] border border-black/5 bg-[#F0B1DE] px-4 py-3">
            <p className="text-[12px] font-bold text-[#4A3140]">Albums</p>
            <p className="mt-1 text-[28px] font-black leading-none tracking-[-0.06em]">
              {albumCount || 0}
            </p>
          </div>

          <div className="rounded-[26px] border border-black/5 bg-[#D0F578] px-4 py-3">
            <p className="text-[12px] font-bold text-[#344318]">Photos</p>
            <p className="mt-1 text-[28px] font-black leading-none tracking-[-0.06em]">
              {photoCount || 0}
            </p>
          </div>

          <div className="rounded-[26px] border border-black/5 bg-[#F6EEE6] px-4 py-3">
            <p className="text-[12px] font-bold text-[#6F5C4E]">Views</p>
            <p className="mt-1 text-[28px] font-black leading-none tracking-[-0.06em]">
              {totalViews}
            </p>
          </div>

          <div className="rounded-[26px] border border-black/5 bg-[#E9F2FB] px-4 py-3">
            <p className="text-[12px] font-bold text-[#40556A]">Shares</p>
            <p className="mt-1 text-[28px] font-black leading-none tracking-[-0.06em]">
              {totalShares}
            </p>
          </div>
        </section>

        {/* STORAGE */}
        <section className="mt-6">
          <div className="rounded-[30px] border border-black/5 bg-white p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-[21px] font-black tracking-[-0.04em]">
                  Storage used
                </p>

                <p className="mt-1 text-[14px] font-semibold text-[#8E8E93]">
                  {formatBytes(totalBytes)} of {formatBytes(storageLimitBytes)}
                </p>
              </div>

              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#F6EEE6] text-[16px] font-black text-[#1C0617]">
                {Math.round(usagePercent)}%
              </div>
            </div>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-[#EEE7E1]">
              <div
                className={`${barColor} h-full rounded-full transition-all duration-500`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-[12px] font-semibold text-[#A0969B]">
              <span>{Math.round(usagePercent)}% used</span>
              <span>
                {formatBytes(Math.max(0, storageLimitBytes - totalBytes))} left
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Link
                href="/pricing"
                className="flex h-12 items-center justify-center rounded-full border border-black/5 bg-[#F0B1DE] px-4 text-sm font-black text-[#1C0617]"
              >
                Manage Plan
              </Link>

              <BillingPortalButton />
            </div>
          </div>
        </section>

        {/* RECENT ALBUMS */}
        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-[25px] font-black tracking-[-0.05em]">
              Recent Albums
            </h2>

            <Link href="/albums" className="text-[14px] font-black text-[#1C0617]">
              See all
            </Link>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-black/5 bg-white">
            {(latestAlbums || []).length > 0 ? (
              (latestAlbums || []).map((album, index) => (
                <Link key={album.id} href={`/albums/${album.id}`}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <div className="relative h-15 w-15 h-[60px] w-[60px] overflow-hidden rounded-[20px] bg-[#F2EEE9]">
                      {album.cover_url ? (
                        <Image
                          src={album.cover_url}
                          alt={album.title || 'Album'}
                          fill
                          sizes="60px"
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs font-bold text-[#B8AEB4]">
                          No
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px] font-black tracking-[-0.03em]">
                        {album.title || 'Untitled Album'}
                      </p>

                      <p className="mt-1 text-[13px] font-semibold text-[#8E8E93]">
                        {Number(album.view_count || 0)} views ·{' '}
                        {Number(album.share_count || 0)} shares
                      </p>
                    </div>

                    <span className="text-3xl font-light text-[#C7C7CC]">›</span>
                  </div>

                  {index < (latestAlbums || []).length - 1 ? (
                    <div className="ml-[92px] h-px bg-[#F0ECE8]" />
                  ) : null}
                </Link>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <AppIcon name="gallery" size={44} className="mb-3 opacity-35" />

                <p className="text-lg font-black text-[#1C0617]">
                  No albums yet
                </p>

                <p className="mt-1 text-sm font-semibold text-[#9A8B92]">
                  Create your first album to start
                </p>
              </div>
            )}
          </div>
        </section>

        {/* SIGN OUT */}
        <form action={signOutAction} className="mt-8">
          <button
            type="submit"
            className="flex h-13 min-h-13 w-full items-center justify-center rounded-full border border-black/5 bg-white text-[15px] font-black text-red-500"
          >
            Sign Out
          </button>
        </form>

        {/* FOOTER */}
        <footer className="text-center">
          <p className="pt-5 text-[13px] font-semibold text-[#B0A6AB]">
            Ciiya Version 23.1
          </p>
        </footer>
      </div>

      {/* BOTTOM NAV */}
      <nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-5 rounded-full bg-white/88 border border-black/5 px-4 py-3 backdrop-blur-xl">
          <Link
            href="/albums"
            className="flex h-11 w-11 items-center justify-center rounded-full text-black"
          >
            <AppIcon name="album" size={24} />
          </Link>

          <Link
            href="/portfolio"
            className="flex h-11 w-11 items-center justify-center rounded-full text-black"
          >
            <AppIcon name="portfolio" size={21} />
          </Link>

          <Link
            href="/ai-retouch"
            className="flex h-11 w-11 items-center justify-center rounded-full text-black"
          >
            <AppIcon name="magic-wand" size={24} />
          </Link>

          <Link
            href="/notifications"
            className="flex h-11 w-11 items-center justify-center rounded-full text-black"
          >
            <AppIcon name="bell" size={20} />
          </Link>

          <Link
            href="/me"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ededed]"
          >
            <AppIcon name="user" size={17} />
          </Link>
        </div>
      </nav>
    </main>
  )
}