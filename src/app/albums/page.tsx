import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import DeleteAlbumButton from '@/components/delete-album-button'
import CreateAlbumModal from '@/components/create-album-modal'
import ProfileAvatarSettings from '@/components/profile-avatar-settings'
import AppIcon from '@/components/app-icon'
import Image from 'next/image'
import AlbumsListClient from '@/components/albums-list-client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AlbumsPage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

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
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[calc(112px+env(safe-area-inset-bottom))] sm:px-8 sm:pt-8 lg:px-12">
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
       <section className="pt-10 sm:pt-14">
          <h1 className="mt-3 text-[clamp(2.4rem,6vw,4.5rem)] font-semibold leading-[0.96] tracking-[-0.045em] text-ink">
  Hi, {(
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    ''
  ).split(' ')[0]}
</h1>

          <p className="mt-3 text-[14px] font-medium tracking-[-0.01em] text-muted">
            {albums.length} Albums · {totalPhotos} photos
          </p>
        </section>

    <AlbumsListClient
  albums={albums}
  photoCountMap={photoCountMap}
/>

        {/* ACTION CARDS */}
      <section className="pt-7">
          <div className="flex min-h-[112px] w-full items-center justify-center rounded-panel border border-gold/30 bg-gold-soft p-5 transition active:scale-[0.99] sm:min-h-[124px]">
             
             <CreateAlbumModal />
             
         </div>
       </section>

        {/* ALBUM LIST */}
      <section className="pt-5">
          <div className="w-full">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-[20px] font-bold tracking-[-0.035em] text-ink">
              My Albums
            </h2>

              <span className="shrink-0 text-[13px] font-semibold text-muted">
                All {albums.length} Albums
              </span>
            </div>

            {albums.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {albums.map((album) => (
                  <div
                    key={album.id}
                    className="relative w-full overflow-hidden rounded-panel border border-line bg-surface p-2 shadow-card"
                  >
                   
                    <DeleteAlbumButton albumId={album.id} />
                    

                    <Link href={`/albums/${album.id}`} className="flex min-w-0 gap-3">
                      <div className="relative h-[86px] w-[96px] shrink-0 overflow-hidden rounded-card bg-ground-sunken">
                        {album.cover_url ? (
                          <Image
                            src={album.cover_url}
                            loading="lazy"
                            alt={album.title || 'Job cover'}
                            fill
                            sizes="96px"
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-muted">
                            No cover
                          </div>
                        )}

                        <span className="absolute bottom-2 left-2 rounded-full bg-ink/75 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                          {photoCountMap[album.id] || 0}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1 py-1 pr-7">
                        <p className="truncate text-[15px] font-semibold tracking-[-0.02em] text-ink sm:text-[16px]">
                          {album.title}
                        </p>

                        <span className="mt-1.5 inline-block rounded-full border border-gold/40 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-deep">
                          Jobs
                        </span>

                        <p className="mt-2 line-clamp-2 text-[12px] font-normal leading-snug text-muted">
                          {album.description || 'No description yet'}
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
                  No jobs yet
                </p>
                <p className="mt-1 text-[13px] font-normal text-muted">
                  Create your first job and start uploading photos
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
            <AppIcon name="gallery" size={22} />
          </Link>

          <Link href="/pricing" className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95"><AppIcon name="magic-wand" size={22} /></Link>

          <Link href="/me" className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95"><AppIcon name="bell" size={20} /></Link>

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
