import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import ShareActions from '@/components/share-actions'
import EditAlbumForm from '@/components/edit-album-form'
import CoverCropUpload from '@/components/cover-crop-upload'
import UploadPhotoModal from '@/components/upload-photo-modal'
import AlbumPhotoGridPreview from '@/components/album-photo-grid-preview'
import AlbumRealtimeRefresher from '@/components/album-realtime-refresher'
import AppIcon from '@/components/app-icon'
import AlbumCameraStatus from '@/components/album-camera-status'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function AlbumDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (albumError || !album) {
    redirect('/albums')
  }

  let shareToken = album.share_token

  if (!shareToken) {
    const newToken = crypto.randomUUID()

    await supabase
      .from('albums')
      .update({ share_token: newToken })
      .eq('id', album.id)
      .eq('owner_id', user.id)

    shareToken = newToken
  }

  const { data: photosData, error: photosError } = await supabase
    .from('photos')
    .select(
      `
      *,
      preview_url,
      thumbnail_url,
      sd_url,
      hd_url,
      uhd_url,
      processing_status,
      processing_progress
      `
    )
    .eq('album_id', id)
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  if (photosError) throw new Error(photosError.message)

  const photos = photosData ?? []
  const photoCount = photos.length

  const { count: peopleCount } = await supabase
    .from('face_clusters')
    .select('id', {
      count: 'exact',
      head: true,
    })
    .eq('album_id', id)

  const { data: categoriesData, error: categoriesError } = await supabase
    .from('categories')
    .select('*')
    .eq('album_id', id)
    .order('created_at', { ascending: true })

  if (categoriesError) throw new Error(categoriesError.message)

  const categories = categoriesData ?? []

  return (
  <main className="min-h-screen bg-[#FAF7F4] text-[#1C0617] text-black">
      <div className="mx-auto flex min-h-dvh w-full max-w-[393px] flex-col px-4 pt-[max(54px,env(safe-area-inset-top))] pb-[calc(104px+env(safe-area-inset-bottom))]">
        {/* HEADER */}
        <section className="px-6 pt-7">
          <div className="flex items-center justify-between">
            <Link
              href="/albums"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-2xl font-black border border-black/5"
            >
              ‹
            </Link>

           <div className="flex items-center gap-3">
              <EditAlbumForm
                albumId={album.id}
                initialTitle={album.title}
                initialDescription={album.description}
                iconOnly
              />

              <CoverCropUpload albumId={album.id} iconOnly />
            </div>
          </div>
 
          <section className="pt-6">
          <h1 className="text-[34px] font-black leading-[0.95] tracking-[-0.07em] text-[#1C0617]">
           {album.title}
          </h1>

          <p className="mt-2 text-[14px] font-semibold leading-relaxed text-[#8E8E93]">
             {album.description || 'No description'}
          </p>
          </section>
        </section>
        
       {/* SUMMARY CARDS */}
<section className="mt-5 grid grid-cols-2 gap-3 pt-3">
  <div className="rounded-[24px] border border-black/5 bg-[#F0B1DE] px-4 py-3">
    <p className="text-[12px] font-bold text-[#4A3140]">
      Photos
    </p>

    <p className="mt-1 text-[26px] font-black leading-none tracking-[-0.05em] text-[#1C0617]">
      {photoCount}
    </p>
  </div>

  <Link
    href={`/albums/${album.id}/people`}
    className="rounded-[24px] border border-black/5 bg-[#D0F578] px-4 py-3 transition active:scale-[0.98]"
  >
    <p className="text-[12px] font-bold text-[#344318]">
      People
    </p>

    <p className="mt-1 text-[26px] font-black leading-none tracking-[-0.05em] text-[#1C0617]">
      {peopleCount || 0}
    </p>
  </Link>
</section>

<AlbumCameraStatus albumId={album.id} />

        {/* ACTION BAR */}
        <section className="pt-5">
          <div className="flex items-center justify-between rounded-[28px] bg-white border border-black/5 p-4">
            <div>
              <p className="text-[16px] font-black tracking-[-0.03em]">
                Share album
              </p>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Send public gallery
              </p>
            </div>

            <div className="shrink-0 rounded-full bg-white px-3 py-2 border border-black/5">
              <ShareActions shareToken={shareToken} />
            </div>
          </div>
        </section>
  
        {/* PHOTO GRID */}
        <section className="mt-6">
          <div className="rounded-[28px] bg-white border border-black/5 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="mb-4">
                <h2 className="text-[24px] sm:text-[30px] font-black tracking-[-0.05em]">
                    Photos
               </h2>
              </div>
            </div>

            {photos.length > 0 ? (
              <AlbumPhotoGridPreview photos={photos} />
            ) : (
              <div className="rounded-[26px] bg-[#F6F7FA] px-6 py-12 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
                  <AppIcon name="album" size={60} className="opacity-30" />
                </div>

                <p className="mt-5 text-22 font-black text-slate-800">
                  No Photos Yet
                </p>

                <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
                  Upload your first JPG photo, then share this album with your
                  clients.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* FLOATING BOTTOM NAV */}
<nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] px-5">
  <div className="mx-auto flex max-w-[390px] items-center justify-between rounded-full border border-black/5 bg-white/90 px-3 py-2">
    <Link
      href="/albums"
      className="flex h-11 w-11 items-center justify-center rounded-full text-black"
    >
      <AppIcon name="album" size={24} />
    </Link>

    <button className="flex h-11 w-11 items-center justify-center rounded-full text-black">
      <AppIcon name="layer" size={24} />
    </button>

    <div className="flex h-14 w-14 items-center justify-center">
  <UploadPhotoModal
    albumId={album.id}
    categories={categories}
    initialAutoFaceScan={album.auto_face_scan}
    initialAutoPublish={album.auto_publish}
  />
</div>

    <Link
      href={`/albums/${album.id}/people`}
      className="flex h-11 w-11 items-center justify-center rounded-full text-black"
    >
      <AppIcon name="users" size={23} />
    </Link>

    <Link
      href="/me"
      className="flex h-11 w-11 items-center justify-center rounded-full text-black"
    >
      <AppIcon name="user-1" size={24} />
    </Link>
  </div>
</nav>

      <AlbumRealtimeRefresher albumId={album.id} />
    </main>
  )
}