import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AppIcon from '@/components/app-icon'
import NotificationsList, { type NotificationItem } from '@/components/notifications-list'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NotificationsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('share_events')
    .select(`
      id,
      album_id,
      event_type,
      metadata,
      read_at,
      created_at,
      albums:album_id(title, cover_url),
      photos:photo_id(thumbnail_url, preview_url)
    `)
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  const items: NotificationItem[] = (data || []).map((row) => {
    const album = Array.isArray(row.albums) ? row.albums[0] : row.albums
    const photo = Array.isArray(row.photos) ? row.photos[0] : row.photos
    return {
      id: row.id,
      albumId: row.album_id,
      albumTitle: album?.title || 'Your gallery',
      eventType: row.event_type,
      createdAt: row.created_at,
      readAt: row.read_at,
      imageUrl: photo?.thumbnail_url || photo?.preview_url || album?.cover_url || null,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    }
  })

  const unreadCount = items.filter((item) => !item.readAt).length

  return (
    <main className="min-h-dvh bg-ground text-ink">
      <div className="mx-auto min-h-dvh w-full max-w-3xl px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[calc(112px+env(safe-area-inset-bottom))] sm:px-8">
        <header className="flex items-center justify-between">
          <Link href="/albums" className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-[22px]">‹</Link>
          <span className="rounded-full border border-line bg-surface px-4 py-2 text-[11px] font-semibold text-muted">
            {unreadCount ? `${unreadCount} unread` : 'All read'}
          </span>
        </header>

        <section className="pt-9 sm:pt-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-deep">Activity center</p>
          <h1 className="mt-3 text-[clamp(2.5rem,8vw,4.6rem)] font-semibold leading-[0.95] tracking-[-0.055em]">Notifications</h1>
          <p className="mt-3 max-w-md text-[14px] leading-6 text-muted">Know when clients and guests interact with every gallery you share.</p>
        </section>

        <NotificationsList initialItems={items} />
      </div>

      <nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-2 rounded-[18px] border border-line bg-surface/95 px-2 py-2 shadow-lift backdrop-blur-xl sm:gap-3">
          <Link href="/albums" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="album" size={22} /></Link>
          <Link href="/portfolio" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="gallery" size={22} /></Link>
          <Link href="/magic" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="magic-wand" size={22} /></Link>
          <Link href="/notifications" className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-soft text-gold-deep"><AppIcon name="bell" size={20} /></Link>
          <Link href="/me" className="flex h-11 w-11 items-center justify-center rounded-full text-muted"><AppIcon name="user-1" size={22} /></Link>
        </div>
      </nav>
    </main>
  )
}
