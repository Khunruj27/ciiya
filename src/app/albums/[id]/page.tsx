import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import ShareActions from '@/components/share-actions'
import DeleteAlbumButton from '@/components/delete-album-button'
import EditAlbumForm from '@/components/edit-album-form'
import CoverCropUpload from '@/components/cover-crop-upload'
import UploadPhotoModal from '@/components/upload-photo-modal'
import AlbumPhotoGridPreview from '@/components/album-photo-grid-preview'
import AlbumRealtimeRefresher from '@/components/album-realtime-refresher'
import AppIcon from '@/components/app-icon'

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

  const { data: categoriesData, error: categoriesError } = await supabase
    .from('categories')
    .select('*')
    .eq('album_id', id)
    .order('created_at', { ascending: true })

  if (categoriesError) throw new Error(categoriesError.message)

  const categories = categoriesData ?? []

  return (
    <main className="min-h-screen bg-[#F8F9FC] pb-32 text-slate-950">
      <AlbumRealtimeRefresher albumId={album.id} />
      

      <div className="mx-auto w-full max-w-[430px] px-1">
        {/* HEADER */}
        <section className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur">
          <div className="grid grid-cols-[40px_1fr_auto] items-center gap-3">
            <Link
              href="/albums"
              className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-slate-700"
            >
              ‹
            </Link>

            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
            Album
        </h1>
        
        
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <h2 className="min-w-0 truncate text-[18px] font-bold">
              {album.title}
            </h2>

            <div className="flex shrink-0 items-center gap-2">


              <EditAlbumForm
                albumId={album.id}
                initialTitle={album.title}
                initialDescription={album.description}
                iconOnly
              />

              <CoverCropUpload albumId={album.id} iconOnly />

              <DeleteAlbumButton albumId={album.id} />
            </div>
          </div>
        </section>

        {/* TABS */}
       <section className="border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between px-4 py-1">
         <div className="text-[14px] text-slate-500">
              Photos({photoCount})
            </div>

            <div className="px-1 py-4 text-slate-500">
              <ShareActions shareToken={shareToken} />
            </div>
          </div>
        </section>

        {/* PHOTO GRID */}
        <section className="px-4 pt-4">
          {photos.length > 0 ? (
            <AlbumPhotoGridPreview photos={photos} />
          ) : (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl">
               <AppIcon
                  name="album"
                  size={50}                // 🔥 ปรับขนาดตรงนี้
                  className="opacity-80"
                />
              </div>

              {/* 🔥 EMPTY STATE */}

      {!photos?.length && (

        <div className="flex flex-col items-center justify-center py-20 text-slate-400">

          <p className="text-sm">No Photos Yet</p>

        </div>

      )}

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Upload your first JPG photo, then share this album with your
                clients.
              </p>
            </div>
          )}
        </section>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3 backdrop-blur-xl">
    <div className="mx-auto grid max-w-[430px] grid-cols-5 items-center gap-1 text-center text-[11px] text-slate-800">
    <Link
      href="/albums"
      className="flex min-h-[58px] flex-col items-center justify-center gap-[5px] px-1 text-[#00000]"
    >
      <AppIcon name="setting" size={22} className="opacity-90" />
      <p className="max-w-[78px] text-center leading-[1.08]">
        CiiyaAlbum<br />Setting
      </p>

    </Link>

    <button className="flex min-h-[58px] flex-col items-center justify-center gap-[5px] px-1 opacity-90">
      <AppIcon name="setting-1" size={22} className="opacity-100" />
      <p className="max-w-[78px] text-center leading-[1.08]">
        Workflow<br />Management
      </p>

    </button>

    <button className="flex min-h-[58px] flex-col items-center justify-center gap-[5px] px-1 opacity-90">
      <AppIcon name="application-1" size={22} className="opacity-100" />
      <p className="max-w-[78px] text-center leading-[1.08]">
        Photo<br />Management
      </p>

    </button>

        
          <UploadPhotoModal albumId={album.id} categories={categories} />
        </div>
      </nav>
    </main>
  )
}