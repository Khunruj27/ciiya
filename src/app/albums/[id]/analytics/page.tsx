import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getServerDictionary } from '@/lib/i18n-server'
import { getUnreadNotificationCount } from '@/lib/notifications'
import AppIcon from '@/components/app-icon'
import NotificationBell from '@/components/notification-bell'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PageProps = { params: Promise<{ id: string }> }

const DAY_MS = 86_400_000

// The owner reads "what time do people come?" in their own clock, so days and
// hours are bucketed in Bangkok time rather than the server's UTC.
const LOCAL_TZ = 'Asia/Bangkok'

function shortDay(date: Date) {
  return new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: LOCAL_TZ }).format(date)
}

// YYYY-MM-DD in local time (en-CA formats in that order).
function localDateKey(iso: string | Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

// Hour 0–23 in local time.
function localHour(iso: string) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: LOCAL_TZ,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso))
  )
}

const TIME_BUCKETS = [
  { label: 'Morning', hint: '06:00–12:00' },
  { label: 'Afternoon', hint: '12:00–17:00' },
  { label: 'Evening', hint: '17:00–21:00' },
  { label: 'Night', hint: '21:00–06:00' },
] as const

function timeBucketIndex(hour: number) {
  if (hour >= 6 && hour < 12) return 0
  if (hour >= 12 && hour < 17) return 1
  if (hour >= 17 && hour < 21) return 2
  return 3
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en').format(value)
}

function getRequestTime() {
  return new Date()
}

export default async function AlbumAnalyticsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { t } = await getServerDictionary()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: album } = await supabase
    .from('albums')
    .select('id, title, cover_url, view_count')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (!album) redirect('/albums')

  const unreadNotificationCount = await getUnreadNotificationCount(supabase, user.id)

  const requestTime = getRequestTime()
  const since = new Date(requestTime.getTime() - 30 * DAY_MS).toISOString()
  const [{ data: photos }, { data: events }, momentsResult] = await Promise.all([
    supabase
      .from('photos')
      .select('id, filename, file_name, thumbnail_url, preview_url, view_count, download_count, like_count')
      .eq('album_id', id)
      .eq('owner_id', user.id),
    supabase
      .from('share_events')
      .select('id, event_type, photo_id, metadata, created_at')
      .eq('album_id', id)
      .eq('owner_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false }),
    supabase
      .from('guest_moments')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', id)
      .eq('status', 'published'),
  ])

  const safePhotos = photos || []
  const safeEvents = events || []
  const totalDownloads = safePhotos.reduce((sum, photo) => sum + Number(photo.download_count || 0), 0)
  const totalLikes = safePhotos.reduce((sum, photo) => sum + Number(photo.like_count || 0), 0)
  const totalPhotoViews = safePhotos.reduce((sum, photo) => sum + Number(photo.view_count || 0), 0)
  const faceSearches = safeEvents.filter((event) => event.event_type === 'face_search').length
  const uniqueDownloads = safeEvents.filter((event) => event.event_type === 'photo_download').length
  const recentViews = safeEvents.filter((event) => event.event_type === 'album_view').length
  const recentLikes = safeEvents.filter((event) => event.event_type === 'photo_like').length

  const daySeries = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(requestTime.getTime() - (6 - index) * DAY_MS)
    const key = localDateKey(date)
    const dayEvents = safeEvents.filter((event) => localDateKey(event.created_at) === key)
    const views = dayEvents.filter((event) => event.event_type === 'album_view').length
    const likes = dayEvents.filter((event) => event.event_type === 'photo_like').length
    return {
      key,
      label: shortDay(date),
      count: dayEvents.length,
      views,
      likes,
      other: dayEvents.length - views - likes,
    }
  })
  const maxDayCount = Math.max(1, ...daySeries.map((day) => day.count))

  // Which part of the day draws the most engagement (local time).
  const bucketCounts = [0, 0, 0, 0]
  for (const event of safeEvents) {
    bucketCounts[timeBucketIndex(localHour(event.created_at))] += 1
  }
  const bucketedTotal = bucketCounts.reduce((sum, value) => sum + value, 0)
  const peakBucketIndex = bucketedTotal ? bucketCounts.indexOf(Math.max(...bucketCounts)) : -1

  // Hour-by-hour histogram (local time), split by views vs hearts.
  const hourSeries = Array.from({ length: 24 }, () => ({ views: 0, likes: 0, other: 0, total: 0 }))
  for (const event of safeEvents) {
    const slot = hourSeries[localHour(event.created_at)]
    if (event.event_type === 'album_view') slot.views += 1
    else if (event.event_type === 'photo_like') slot.likes += 1
    else slot.other += 1
    slot.total += 1
  }
  const maxHourCount = Math.max(1, ...hourSeries.map((hour) => hour.total))
  const peakHour = bucketedTotal
    ? hourSeries.reduce((best, hour, index) => (hour.total > hourSeries[best].total ? index : best), 0)
    : -1
  const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
  const peakHourRange =
    peakHour >= 0 ? `${hourLabel(peakHour)}–${hourLabel((peakHour + 1) % 24)}` : ''

  const engagementSplit = [
    { label: t.analytics.statViews, value: recentViews, dot: 'bg-gold' },
    { label: t.analytics.statHearts, value: recentLikes, dot: 'bg-rose-400' },
    { label: t.analytics.statDownloads, value: uniqueDownloads, dot: 'bg-ink/30' },
  ]

  const topPhotos = [...safePhotos]
    .map((photo) => ({
      ...photo,
      score: Number(photo.view_count || 0) + Number(photo.download_count || 0) * 3 + Number(photo.like_count || 0) * 2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const metrics = [
    { label: t.analytics.metricGalleryViews, value: Number(album.view_count || 0), detail: t.analytics.detailInLast30(recentViews) },
    { label: t.analytics.metricDownloads, value: totalDownloads, detail: t.analytics.detailRecentlyTracked(uniqueDownloads) },
    { label: t.analytics.metricHearts, value: totalLikes, detail: t.analytics.detailAcrossPhotos },
    { label: t.analytics.metricFaceSearches, value: faceSearches, detail: t.analytics.detailLast30 },
    { label: t.analytics.metricGuestMoments, value: Number(momentsResult.count || 0), detail: t.analytics.detailPublishedByGuests },
    { label: t.analytics.metricPhotoOpens, value: totalPhotoViews, detail: t.analytics.detailAcrossGallery },
  ]

  return (
    <main className="min-h-dvh bg-ground text-ink">
      <div className="mx-auto min-h-dvh w-full max-w-6xl px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[calc(112px+env(safe-area-inset-bottom))] sm:px-8 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <Link href={`/albums/${id}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-[22px]">‹</Link>
          <span className="rounded-full border border-line bg-surface px-4 py-2 text-[11px] font-semibold text-muted">{t.analytics.last30Days}</span>
        </header>

        <section className="pt-9 sm:pt-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-deep">{t.analytics.galleryInsights}</p>
          <h1 className="mt-3 max-w-3xl text-[clamp(2.5rem,8vw,5rem)] font-semibold leading-[0.95] tracking-[-0.055em]">{album.title}</h1>
          <p className="mt-3 text-[14px] leading-6 text-muted">{t.analytics.insightsDesc}</p>
        </section>

        <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
          {metrics.map((metric, index) => (
            <article key={metric.label} className={`rounded-panel border p-4 sm:p-5 ${index === 0 ? 'border-gold/40 bg-gold-soft' : 'border-line bg-surface'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{metric.label}</p>
              <p className="mt-3 text-[clamp(2rem,6vw,3.3rem)] font-semibold leading-none tracking-[-0.055em]">{formatNumber(metric.value)}</p>
              <p className="mt-2 text-[11px] leading-5 text-muted">{metric.detail}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-hero border border-line bg-surface p-5 sm:p-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-deep">{t.analytics.activity7Day}</p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.035em]">{t.analytics.whenEngage}</h2>
            </div>
            <p className="text-[12px] text-muted">{t.analytics.eventsCount(safeEvents.length)}</p>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            {engagementSplit.map((item) => (
              <div key={item.label} className="rounded-panel border border-line bg-ground px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${item.dot}`} />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{item.label}</p>
                </div>
                <p className="mt-2 text-[clamp(1.4rem,4vw,1.9rem)] font-semibold leading-none tracking-[-0.04em]">{formatNumber(item.value)}</p>
                <p className="mt-1 text-[10px] text-muted">{t.analytics.last30Days}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid h-52 grid-cols-7 items-end gap-2 sm:gap-4">
            {daySeries.map((day) => (
              <div key={day.key} className="flex h-full min-w-0 flex-col justify-end text-center">
                <span className="mb-2 text-[10px] font-semibold tabular-nums text-muted">{day.count || ''}</span>
                <div className="flex h-36 items-end rounded-2xl bg-ground-sunken p-1">
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-xl transition-all"
                    style={{ height: `${day.count ? Math.max(10, (day.count / maxDayCount) * 100) : 3}%` }}
                  >
                    {day.views ? <div className="w-full bg-gold" style={{ flexGrow: day.views, flexBasis: 0 }} /> : null}
                    {day.likes ? <div className="w-full bg-rose-400" style={{ flexGrow: day.likes, flexBasis: 0 }} /> : null}
                    {day.other ? <div className="w-full bg-ink/25" style={{ flexGrow: day.other, flexBasis: 0 }} /> : null}
                  </div>
                </div>
                <span className="mt-2 truncate text-[10px] font-medium text-muted">{day.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            {engagementSplit.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-2 text-[11px] text-muted">
                <span className={`h-2 w-2 rounded-full ${item.dot}`} />
                {item.label}
              </span>
            ))}
          </div>

          <div className="mt-8 border-t border-line pt-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-deep">{t.analytics.busiestTime}</p>
                <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em]">{t.analytics.whenShowUp}</h3>
              </div>
              {peakHour >= 0 ? (
                <span className="rounded-full bg-gold-soft px-3 py-1.5 text-[11px] font-semibold text-gold-deep">
                  {t.analytics.peak(peakHourRange)}
                </span>
              ) : null}
            </div>

            {peakHour >= 0 ? (
              <>
                <div className="mt-6 flex h-40 items-end gap-[2px] sm:gap-[3px]">
                  {hourSeries.map((hour, index) => (
                    <div
                      key={index}
                      title={t.analytics.hourTitle(hourLabel(index), hour.total)}
                      className={`flex h-full flex-1 flex-col justify-end rounded-[4px] pt-1 ${
                        index === peakHour ? 'bg-gold-soft/70' : ''
                      }`}
                    >
                      <div
                        className="flex w-full flex-col-reverse overflow-hidden rounded-[3px] transition-all"
                        style={{ height: `${hour.total ? Math.max(5, (hour.total / maxHourCount) * 100) : 2}%` }}
                      >
                        {hour.views ? <div className="w-full bg-gold" style={{ flexGrow: hour.views, flexBasis: 0 }} /> : null}
                        {hour.likes ? <div className="w-full bg-rose-400" style={{ flexGrow: hour.likes, flexBasis: 0 }} /> : null}
                        {hour.other ? <div className="w-full bg-ink/25" style={{ flexGrow: hour.other, flexBasis: 0 }} /> : null}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex justify-between text-[9px] font-medium tabular-nums text-muted">
                  <span>00:00</span>
                  <span>06:00</span>
                  <span>12:00</span>
                  <span>18:00</span>
                  <span>23:00</span>
                </div>

                <p className="mt-4 text-[12px] leading-5 text-muted">
                  {t.analytics.mostPeopleAround}{' '}
                  <span className="font-semibold text-ink">{peakHourRange}</span>
                  {peakBucketIndex >= 0 ? (
                    <>
                      {t.analytics.theBucket}{' '}
                      <span className="font-semibold text-ink">{t.analytics.bucketName(peakBucketIndex)}</span>{' '}
                      ({TIME_BUCKETS[peakBucketIndex].hint})
                    </>
                  ) : null}
                  {t.analytics.localTimeNote}
                </p>
              </>
            ) : (
              <p className="mt-6 rounded-panel bg-ground px-5 py-8 text-center text-[13px] text-muted">
                {t.analytics.timesWillAppear}
              </p>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-hero border border-line bg-surface p-5 sm:p-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-deep">{t.analytics.topPhotographs}</p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.035em]">{t.analytics.mostEngaging}</h2>
            </div>
            <span className="text-[11px] text-muted">{t.analytics.viewsHeartsDownloads}</span>
          </div>

          {topPhotos.length ? (
            <div className="mt-5 divide-y divide-line">
              {topPhotos.map((photo, index) => (
                <div key={photo.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <span className="w-5 text-[12px] font-semibold text-gold-deep">{String(index + 1).padStart(2, '0')}</span>
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-card bg-ground-sunken">
                    {photo.thumbnail_url || photo.preview_url ? (
                      <Image src={photo.thumbnail_url || photo.preview_url} alt="" fill sizes="56px" unoptimized className="object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{photo.filename || photo.file_name || t.analytics.photoDefault}</p>
                    <p className="mt-1 text-[11px] text-muted">{t.analytics.photoStats(Number(photo.view_count || 0), Number(photo.like_count || 0), Number(photo.download_count || 0))}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-6 rounded-panel bg-ground px-5 py-8 text-center text-[13px] text-muted">{t.analytics.engagementWillAppear}</p>
          )}
        </section>
      </div>

      <nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-2 rounded-[18px] border border-line bg-surface/95 px-2 py-2 shadow-lift backdrop-blur-xl sm:gap-3">
          <Link href="/albums" className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-soft text-gold-deep"><AppIcon name="album bold" size={22} /></Link>
          <Link href="/portfolio" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="gallery" size={22} /></Link>
          <NotificationBell userId={user.id} initialCount={unreadNotificationCount} size={20} />
          <Link href="/me" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="user-1" size={22} /></Link>
        </div>
      </nav>
    </main>
  )
}
