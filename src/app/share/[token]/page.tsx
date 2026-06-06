import PublicGalleryInfinite from '@/components/public-gallery-infinite'
import ShareViewTracker from '@/components/share-view-tracker'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import ScrollToTopButton from '@/components/scroll-to-top-button'
import SelfieFaceSearch from '@/components/selfie-face-search'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PageProps = {
  params: Promise<{ token: string }>
}

const PAGE_SIZE = 50

export default async function SharePage({ params }: PageProps) {
  const { token } = await params
  const supabase = await createServerSupabaseClient()

  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select(
      `
      id,
      title,
      description,
      cover_url,
      share_token,
      view_count,
      created_at
      `
    )
    .eq('share_token', token)
    .maybeSingle()

  if (albumError || !album) {
    return (
      <main className="min-h-screen bg-[#F5F5F7] px-4 py-10 text-black">
        <div className="mx-auto max-w-[430px] rounded-[36px] bg-white p-7 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <p className="text-[13px] font-semibold text-[#8E8E93]">
            Ciiya Gallery
          </p>

          <h1 className="mt-3 text-[32px] font-black tracking-[-0.06em]">
            Album not found
          </h1>

          <p className="mt-3 text-[15px] font-medium leading-6 text-[#8E8E93]">
            This shared album does not exist or is no longer available.
          </p>
        </div>
      </main>
    )
  }

  const { count: photoCountResult } = await supabase
    .from('photos')
    .select('id', {
      count: 'exact',
      head: true,
    })
    .eq('album_id', album.id)
    .eq('processing_status', 'done')
    .not('preview_url', 'is', null)
    .not('thumbnail_url', 'is', null)

  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select(
      `
      id,
      album_id,
      filename,
      public_url,
      preview_url,
      thumbnail_url,
      blur_data_url,
      created_at,
      view_count,
      processing_status
      `
    )
    .eq('album_id', album.id)
    .eq('processing_status', 'done')
    .not('preview_url', 'is', null)
    .not('thumbnail_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)

  if (photosError) {
    throw new Error(photosError.message)
  }

  const visiblePhotos = photos ?? []
  const photoCount = photoCountResult || 0

  const initialCursor =
    visiblePhotos.length > 0
      ? visiblePhotos[visiblePhotos.length - 1].created_at
      : null

  return (
   <main className="min-h-screen bg-[#FAF7F4] text-[#1C0617]">
      <ShareViewTracker token={token} />

      {/* HERO */}
      <section className="overflow-hidden rounded-[34px] border border-black/5 bg-white p-2">
        <div className="relative h-[280px] overflow-hidden rounded-[28px] bg-[#F2EEE9]">
          <div className="relative overflow-hidden rounded-[10px] bg-black shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
            <div className="relative h-[240px]">
              {album.cover_url ? (
                <img
                  src={album.cover_url}
                  alt={album.title || 'Album cover'}
                  loading="eager"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-[#72D8FF] via-[#5B8CFF] to-[#315BFF]" />
              )}

              <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/20 to-black/78" />

              <div className="absolute left-5 right-5 top-5 flex items-center justify-between">
                <div className="rounded-full bg-white/18 px-4 py-2 text-[12px] font-bold text-white backdrop-blur-xl">
                  Gallery
                </div>

                <div className="rounded-full bg-white/18 px-4 py-2 text-[12px] font-bold text-white backdrop-blur-xl">
                  Live album
                </div>
              </div>
              
              
              <div className="absolute bottom-4 left-4 right-4">
               <p className="text-[12px] font-black uppercase tracking-[0.16em] text-white/70">
                Shared Album
              </p>

             <h1 className="mt-2 text-[32px] font-black leading-[0.95] tracking-[-0.06em] text-white">
                {album.title}
             </h1>

            <p className="mt-2 line-clamp-2 text-[13px] font-semibold leading-snug text-white/75">
            {album.description || 'View and download your event photos'}
            </p>
            </div>
              
            </div>
          </div>
        </div>
      </section>

     <section className="mt-4 grid grid-cols-2 gap-3">
  <div className="rounded-[24px] border border-black/5 bg-[#F0B1DE] px-4 py-3">
    <p className="text-[12px] font-bold text-[#4A3140]">
      Photos
    </p>
    <p className="mt-1 text-[26px] font-black leading-none tracking-[-0.05em]">
      {photos.length}
    </p>
  </div>

  <div className="rounded-[24px] border border-black/5 bg-[#D0F578] px-4 py-3">
    <p className="text-[12px] font-bold text-[#344318]">
      Views
    </p>
    <p className="mt-1 text-[26px] font-black leading-none tracking-[-0.05em]">
      {album.view_count || 0}
    </p>
  </div>
</section>

      {/* CONTENT */}
      <section className="px-4 pb-12 pt-5">
        <div className="mx-auto max-w-[430px] space-y-5">
          <SelfieFaceSearch albumId={album.id} />

          {visiblePhotos.length > 0 ? (
            <PublicGalleryInfinite
              initialPhotos={visiblePhotos}
              totalCount={photoCount}
              albumTitle={album.title}
              albumId={album.id}
              shareToken={token}
              initialCursor={initialCursor}
            />
          ) : (
            <div className="rounded-[36px] bg-white px-7 py-14 text-center border border-black/5">
              <p className="text-[22px] font-black tracking-[-0.04em] text-slate-900">
                No photos yet
              </p>

              <p className="mt-2 text-[15px] font-medium leading-6 text-[#8E8E93]">
                This album is ready, but no photos have been published yet.
              </p>
            </div>
          )}

          <div className="rounded-[34px] bg-white p-3 text-center  border border-black/5">
            <p className="text-[16px] font-black tracking-[-0.03em] text-slate-950">
              Powered by Ciiya
            </p>

            <p className="mt-1 text-[13px] font-medium text-[#8E8E93]">
              Photos sharing gallery
            </p>
          </div>
        </div>
      </section>

      <ScrollToTopButton />
    </main>
  )
}