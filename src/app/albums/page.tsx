import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUnreadNotificationCount } from '@/lib/notifications'
import { getServerDictionary } from '@/lib/i18n-server'
import DeleteAlbumButton from '@/components/delete-album-button'
import CreateAlbumModal from '@/components/create-album-modal'
import ProfileAvatarSettings from '@/components/profile-avatar-settings'
import AppIcon from '@/components/app-icon'
import Image from 'next/image'
import AlbumsListClient from '@/components/albums-list-client'
import NotificationBell from '@/components/notification-bell'
import styles from './albums.module.css'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AlbumsPage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { t, locale } = await getServerDictionary()

  const { data: albumsData } = await supabase
  .from('albums')
  .select(
    `
    id,
    owner_id,
    user_id,
    title,
    description,
    cover_url,
    share_token,
    photo_count,
    view_count,
    share_count,
    status,
    created_at,
    updated_at
    `
  )
  .eq('owner_id', user.id)
  .order('created_at', { ascending: false })

  const albums = albumsData ?? []

  const unreadNotificationCount = await getUnreadNotificationCount(supabase, user.id)

  const photoCountMap = albums.reduce<Record<string, number>>((acc, album) => {
    acc[album.id] = album.photo_count || 0
    return acc
  }, {})

  const totalPhotos = albums.reduce(
    (sum, album) => sum + (album.photo_count || 0),
    0
  )

  return (
    <main className="min-h-dvh overflow-x-hidden bg-ground text-ink">
      <div className={styles.container}>
        {/* HEADER */}
       <section className="shrink-0">
          <div className="flex w-full items-center justify-between">
            <Image
              src="/logo-usage.svg"
              alt="Ciiya Logo"
              width={120}
              height={40}
              priority
              className="h-8 w-auto max-w-[132px]"
            />

            <div className="shrink-0 rounded-full border border-line bg-surface">
  <ProfileAvatarSettings
    email={user.email}
    initialAvatarUrl={user.user_metadata?.avatar_url || null}
  />
</div>
          </div>
        </section>

        {/* HERO */}
       <section className={styles.hero}>
         <div className={styles.heroCopy}>
          <p className={styles.greeting}>
  {t.albums.greeting}, {(
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    ''
  ).split(' ')[0]}
</p>
          <h1 className={styles.title}>{t.albums.myAlbums}</h1>
          <p className={styles.subtitle}>{locale === 'th' ? 'ทุกงานถ่ายภาพ พร้อมส่งต่อความทรงจำ' : 'Every collection, ready to be shared.'}</p>

          <p className={styles.summary}>
            <span>{albums.length.toLocaleString(locale)} {t.albums.albumsWord}</span><span>{totalPhotos.toLocaleString(locale)} {t.albums.photosWord}</span>
          </p>
          </div>
          <div className={styles.create}><CreateAlbumModal /></div>
        </section>

    <AlbumsListClient
  albums={albums}
  photoCountMap={photoCountMap}
/>

        {/* ALBUM LIST */}
      <section className="pt-5">
          <div className="w-full">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-[16px] font-medium text-ink">
              {locale === 'th' ? 'อัลบั้มทั้งหมด' : 'All albums'}
            </h2>

              <span className="shrink-0 text-[13px] font-semibold text-muted">
                {t.albums.all} {albums.length} {t.albums.albumsWord}
              </span>
            </div>

            {albums.length > 0 ? (
              <div className={styles.grid}>
                {albums.map((album) => (
                  <div
                    key={album.id}
                    className={styles.card}
                  >
                   
                    <div className={styles.deleteAction}><DeleteAlbumButton albumId={album.id} /></div>
                    

                    <Link href={`/albums/${album.id}`} className={styles.albumLink}>
                      <div className={styles.cover}>
                        {album.cover_url ? (
                          <Image
                            src={album.cover_url}
                            loading="lazy"
                            alt={album.title || t.albums.jobCover}
                            fill
                            sizes="(max-width: 600px) 112px, (max-width: 1000px) 45vw, 340px"
                            unoptimized
                            className={styles.coverImage}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-muted">
                            {t.albums.noCover}
                          </div>
                        )}

                        <span className="absolute bottom-2 left-2 rounded-full bg-ink/75 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                          {(photoCountMap[album.id] || 0).toLocaleString(locale)} {t.albums.photosWord}
                        </span>
                      </div>

                      <div className={styles.details}>
                        <p className={styles.albumTitle}>
                          {album.title || t.me.untitledJob}
                        </p>

                        <time dateTime={album.created_at} className={styles.date}>
                          {new Date(album.created_at).toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </time>

                        <p className="mt-2 line-clamp-2 text-[12px] font-normal leading-snug text-muted">
                          {album.description || t.albums.noDescription}
                        </p>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AppIcon name="gallery" size={46} className="mb-3 opacity-35" />
                <p className="text-[17px] font-semibold text-ink">
                  {t.albums.noJobs}
                </p>
                <p className="mt-1 text-[13px] font-normal text-muted">
                  {t.albums.noJobsSub}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* FLOATING BOTTOM NAV */}
      <nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-2 rounded-[18px] border border-line bg-surface/95 px-2 py-2 shadow-lift backdrop-blur-xl sm:gap-3">
          <Link
            href="/albums"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-soft text-gold-deep"
          >
            <AppIcon name="album bold" size={22} />
          </Link>

           <Link
            href="/portfolio"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95"
          >
            <AppIcon name="magic-wand" size={22} />
          </Link>

          <NotificationBell
            userId={user.id}
            initialCount={unreadNotificationCount}
          />

          <Link
            href="/me"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95"
          >
            <AppIcon name="user-1" size={22} />
          </Link>
        </div>
      </nav>
    </main>
  )
}
