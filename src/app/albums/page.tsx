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
  const albumIds = albums.map((a) => a.id)

  const { data: photoRowsData } =
    albumIds.length > 0
      ? await supabase.from('photos').select('album_id').in('album_id', albumIds)
      : { data: [] }

  const photoRows = photoRowsData ?? []

  const photoCountMap = photoRows.reduce<Record<string, number>>((acc, row) => {
    const id = String(row.album_id)
    acc[id] = (acc[id] || 0) + 1
    return acc
  }, {})

  const totalPhotos = photoRows.length

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#F9F9F9] text-black">
      <div className="mx-auto flex min-h-dvh w-full max-w-[393px] flex-col px-4 pt-[max(54px,env(safe-area-inset-top))] pb-[calc(104px+env(safe-area-inset-bottom))]">
        {/* HEADER */}
       <section className="shrink-0">
          <div className="flex w-full items-center justify-between">
            <Image
              src="/Ciiya.svg"
              alt="Ciiya Logo"
              width={120}
              height={40}
              priority
              className="h-8 w-auto max-w-[132px]"
            />

            <div className="shrink-0 rounded-full bg-white border border-black/5">
  <ProfileAvatarSettings
    email={user.email}
    initialAvatarUrl={user.user_metadata?.avatar_url || null}
  />
</div>
          </div>
        </section>

        {/* HERO */}
       <section className="pt-6">
          <h1 className="mt-4 text-[38px] font-black leading-[0.94] tracking-[-0.06em] text-black">
  Hello, {(
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    'User'
  ).split(' ')[0]}!  
</h1>

          <p className="mt-3 text-[15px] font-bold tracking-[-0.02em] text-black">
            {albums.length} albums · {totalPhotos} photos
          </p>
        </section>

    <AlbumsListClient
  albums={albums}
  photoCountMap={photoCountMap}
/>

        {/* ACTION CARDS */}
      <section className="pt-6">
          <div className="flex min-h-[132px] w-full items-center justify-center rounded-[28px] bg-[#f0B1DE] p-5 text-white border border-black/5 transition active:scale-[0.98]">
             
             <CreateAlbumModal />
             
         </div>
       </section>

        {/* ALBUM LIST */}
      <section className="pt-5">
          <div className="w-full">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-[24px] font-black tracking-[-0.05em]">
              Your albums
            </h2>

              <span className="shrink-0 text-[15px] font-bold text-black/80">
                See all
              </span>
            </div>

            {albums.length > 0 ? (
              <div className="space-y-3">
                {albums.map((album) => (
                  <div
                    key={album.id}
                    className="relative w-full overflow-hidden rounded-[22px] bg-white p-2 border border-black/5"
                  >
                   
                    <DeleteAlbumButton albumId={album.id} />
                    

                    <Link href={`/albums/${album.id}`} className="flex min-w-0 gap-3">
                      <div className="relative h-[86px] w-[96px] shrink-0 overflow-hidden rounded-[18px] bg-slate-100">
                        {album.cover_url ? (
                          <Image
                            src={album.cover_url}
                            loading="lazy"
                            alt={album.title || 'Album cover'}
                            fill
                            sizes="96px"
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-slate-400">
                            No Cover
                          </div>
                        )}

                        <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-[11px] font-bold text-white">
                          {photoCountMap[album.id] || 0}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1 py-1 pr-7">
                        <p className="truncate text-[15px] sm:text-[16px] font-black tracking-[-0.03em] text-black">
                          {album.title}
                        </p>

                        <span className="mt-1 inline-block rounded-full bg-black px-3 py-1 text-[11px] font-bold text-white">
                          Album
                        </span>

                        <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-snug text-slate-500">
                          {album.description || 'No description'}
                        </p>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AppIcon name="gallery" size={46} className="mb-3 opacity-35" />
                <p className="text-lg font-black text-slate-800">
                  No albums yet
                </p>
                <p className="mt-1 text-sm font-medium text-slate-400">
                  Create your first album to start
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* FLOATING BOTTOM NAV */}
      <nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-5 rounded-full bg-white/88 border border-black/5 px-4 py-3 backdrop-blur-xl">
          <Link
            href="/albums"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ebebeb]"
          >
            <AppIcon name="album bold" size={22} />
          </Link>

           <Link
            href="/portfolio"
            className="flex h-11 w-11 items-center justify-center rounded-full text-black"
          >
            <AppIcon name="portfolio" size={22} />
          </Link>

          <button className="flex h-11 w-11 items-center justify-center rounded-full text-black">
            <AppIcon name="magic-wand" size={22} />
          </button>

          <button className="flex h-11 w-11 items-center justify-center rounded-full text-black">
            <AppIcon name="bell" size={20} />
          </button>

          <Link
            href="/me"
            className="flex h-11 w-11 items-center justify-center rounded-full text-black"
          >
            <AppIcon name="user-1" size={22} />
          </Link>
        </div>
      </nav>
    </main>
  )
}