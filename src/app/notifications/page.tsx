import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AppIcon from '@/components/app-icon'
import NotificationBell from '@/components/notification-bell'
import { getServerDictionary } from '@/lib/i18n-server'
import NotificationsList, {
  type AnnouncementNotification,
  type NotificationItem,
} from '@/components/notifications-list'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NotificationsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { t } = await getServerDictionary()

  const [{ data }, { data: announcementData }] = await Promise.all([
    supabase.from('share_events').select(`
      id,
      album_id,
      event_type,
      metadata,
      read_at,
      created_at,
      albums:album_id(title, cover_url),
      photos:photo_id(thumbnail_url, preview_url)
    `).eq('owner_id', user.id).order('created_at', { ascending: false }).limit(100),
    supabase.from('announcements').select(`
      id,
      announcement_type,
      title,
      summary,
      body,
      image_url,
      cta_label,
      cta_url,
      priority,
      starts_at,
      announcement_reads(read_at, clicked_at)
    `).order('starts_at', { ascending: false }).limit(50),
  ])

  const items: NotificationItem[] = (data || []).map((row) => {
    const album = Array.isArray(row.albums) ? row.albums[0] : row.albums
    const photo = Array.isArray(row.photos) ? row.photos[0] : row.photos
    return {
      id: row.id,
      albumId: row.album_id,
      albumTitle: album?.title || t.notif.yourGallery,
      eventType: row.event_type,
      createdAt: row.created_at,
      readAt: row.read_at,
      imageUrl: photo?.thumbnail_url || photo?.preview_url || album?.cover_url || null,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    }
  })

  const unreadCount = items.filter((item) => !item.readAt).length

  const announcements: AnnouncementNotification[] = (announcementData || []).map((row) => {
    const read = Array.isArray(row.announcement_reads)
      ? row.announcement_reads[0]
      : row.announcement_reads
    return {
      id: row.id,
      announcementType: row.announcement_type,
      title: row.title,
      summary: row.summary,
      body: row.body,
      imageUrl: row.image_url,
      ctaLabel: row.cta_label,
      ctaUrl: row.cta_url,
      priority: row.priority,
      createdAt: row.starts_at,
      readAt: read?.read_at || null,
    }
  })

  const totalUnreadCount = unreadCount + announcements.filter((item) => !item.readAt).length

  return (
    <main className="min-h-dvh bg-ground text-ink">
      <div className="mx-auto min-h-dvh w-full max-w-3xl px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[calc(112px+env(safe-area-inset-bottom))] sm:px-8">
        <header className="flex items-center justify-between">
          <Link href="/albums" className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-[22px]">‹</Link>
          <span className="rounded-full border border-line bg-surface px-4 py-2 text-[11px] font-semibold text-muted">
            {totalUnreadCount ? t.notif.unreadBadge(totalUnreadCount) : t.notif.allRead}
          </span>
        </header>

        <section className="pt-9 sm:pt-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-deep">{t.notif.center}</p>
          <h1 className="mt-3 text-[clamp(2.5rem,8vw,4.6rem)] font-semibold leading-[0.95] tracking-[-0.055em]">{t.notif.title}</h1>
          <p className="mt-3 max-w-md text-[14px] leading-6 text-muted">{t.notif.subtitle}</p>
        </section>

        <NotificationsList initialItems={items} initialAnnouncements={announcements} />
      </div>

      <nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-2 rounded-[18px] border border-line bg-surface/95 px-2 py-2 shadow-lift backdrop-blur-xl sm:gap-3">
          <Link href="/albums" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="album" size={22} /></Link>
          <Link href="/portfolio" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="magic-wand" size={22} /></Link>
          <NotificationBell userId={user.id} initialCount={totalUnreadCount} active size={20} />
          <Link href="/me" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="user-1" size={22} /></Link>
        </div>
      </nav>
    </main>
  )
}
