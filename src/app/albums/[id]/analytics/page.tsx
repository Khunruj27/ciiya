import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AppIcon from '@/components/app-icon'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PageProps = { params: Promise<{ id: string }> }

const DAY_MS = 86_400_000

function shortDay(date: Date) {
  return new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date)
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: album } = await supabase
    .from('albums')
    .select('id, title, cover_url, view_count')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (!album) redirect('/albums')

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

  const daySeries = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(requestTime.getTime() - (6 - index) * DAY_MS)
    const key = date.toISOString().slice(0, 10)
    const count = safeEvents.filter((event) => event.created_at.slice(0, 10) === key).length
    return { key, label: shortDay(date), count }
  })
  const maxDayCount = Math.max(1, ...daySeries.map((day) => day.count))

  const topPhotos = [...safePhotos]
    .map((photo) => ({
      ...photo,
      score: Number(photo.view_count || 0) + Number(photo.download_count || 0) * 3 + Number(photo.like_count || 0) * 2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const metrics = [
    { label: 'Gallery views', value: Number(album.view_count || 0), detail: `${recentViews} in the last 30 days` },
    { label: 'Downloads', value: totalDownloads, detail: `${uniqueDownloads} recently tracked` },
    { label: 'Hearts', value: totalLikes, detail: 'Across all photographs' },
    { label: 'Face searches', value: faceSearches, detail: 'Last 30 days' },
    { label: 'Guest moments', value: Number(momentsResult.count || 0), detail: 'Published by guests' },
    { label: 'Photo opens', value: totalPhotoViews, detail: 'Across the gallery' },
  ]

  return (
    <main className="min-h-dvh bg-ground text-ink">
      <div className="mx-auto min-h-dvh w-full max-w-6xl px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[calc(112px+env(safe-area-inset-bottom))] sm:px-8 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <Link href={`/albums/${id}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-[22px]">‹</Link>
          <span className="rounded-full border border-line bg-surface px-4 py-2 text-[11px] font-semibold text-muted">Last 30 days</span>
        </header>

        <section className="pt-9 sm:pt-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-deep">Gallery insights</p>
          <h1 className="mt-3 max-w-3xl text-[clamp(2.5rem,8vw,5rem)] font-semibold leading-[0.95] tracking-[-0.055em]">{album.title}</h1>
          <p className="mt-3 text-[14px] leading-6 text-muted">See how clients and guests are engaging with this shared gallery.</p>
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-deep">7-day activity</p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.035em]">When people engage</h2>
            </div>
            <p className="text-[12px] text-muted">{safeEvents.length} events · 30 days</p>
          </div>

          <div className="mt-8 grid h-52 grid-cols-7 items-end gap-2 sm:gap-4">
            {daySeries.map((day) => (
              <div key={day.key} className="flex h-full min-w-0 flex-col justify-end text-center">
                <span className="mb-2 text-[10px] font-semibold tabular-nums text-muted">{day.count || ''}</span>
                <div className="flex h-36 items-end rounded-full bg-ground-sunken p-1">
                  <div
                    className="w-full rounded-full bg-gold transition-all"
                    style={{ height: `${day.count ? Math.max(12, (day.count / maxDayCount) * 100) : 4}%` }}
                  />
                </div>
                <span className="mt-2 truncate text-[10px] font-medium text-muted">{day.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-hero border border-line bg-surface p-5 sm:p-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-deep">Top photographs</p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.035em]">Most engaging images</h2>
            </div>
            <span className="text-[11px] text-muted">Views + hearts + downloads</span>
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
                    <p className="truncate text-[13px] font-semibold">{photo.filename || photo.file_name || 'Photo'}</p>
                    <p className="mt-1 text-[11px] text-muted">{Number(photo.view_count || 0)} views · {Number(photo.like_count || 0)} hearts · {Number(photo.download_count || 0)} downloads</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-6 rounded-panel bg-ground px-5 py-8 text-center text-[13px] text-muted">Engagement will appear after guests begin viewing the gallery.</p>
          )}
        </section>
      </div>

      <nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-2 rounded-[18px] border border-line bg-surface/95 px-2 py-2 shadow-lift backdrop-blur-xl sm:gap-3">
          <Link href="/albums" className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-soft text-gold-deep"><AppIcon name="album bold" size={22} /></Link>
          <Link href="/portfolio" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="gallery" size={22} /></Link>
          <Link href="/notifications" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="bell" size={20} /></Link>
          <Link href="/me" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="user-1" size={22} /></Link>
        </div>
      </nav>
    </main>
  )
}
