import PublicGallery from '@/components/public-gallery'
import ShareViewTracker from '@/components/share-view-tracker'
import PublicTopBar from '@/components/public-top-bar'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import PublicGalleryRealtime from '@/components/public-gallery-realtime'
import ScrollToTopButton from '@/components/scroll-to-top-button'
import FaceSearchButton from '@/components/face-search-button'

type PageProps = {
  params: Promise<{ token: string }>
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params
  const supabase = await createServerSupabaseClient()

  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select('*')
    .eq('share_token', token)
    .single()

  if (albumError || !album) {
    return (
      <main className="min-h-screen bg-[#f6f7fb] px-4 py-10">
        <div className="mx-auto max-w-md rounded-[32px] bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
            Ciiya Gallery
          </p>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">
            Album not found
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            This shared album does not exist or is no longer available.
          </p>
        </div>
      </main>
    )
  }

  const { data: photos, count, error: photosError } = await supabase
    .from('photos')
    .select('*', { count: 'exact' })
    .eq('album_id', album.id)
    .order('created_at', { ascending: false })
    .range(0, 49)

  if (photosError) {
    throw new Error(photosError.message)
  }

  const photoCount = count || 0

  return (
    <main className="min-h-screen bg-[#f6f7fb]">
      <ShareViewTracker token={token} />
      <PublicGalleryRealtime albumId={album.id} />

      <section className="relative overflow-hidden px-4 pb-24 pt-10 text-white">
        <div className="absolute inset-0">
          {album.cover_url ? (
            <img
              src={album.cover_url}
              alt={album.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700" />
          )}

          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/45 to-black/70" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#f6f7fb] to-transparent" />
        </div>

        <div className="relative mx-auto max-w-md">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-white/70">
                Ciiya Photosharing
              </p>

              <h1 className="mt-3 text-3xl font-bold leading-tight drop-shadow-sm">
                {album.title}
              </h1>
            </div>

            <div className="rounded-full bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur-md">
              Public
            </div>
          </div>

          <p className="mt-4 max-w-sm text-sm leading-6 text-white/85">
            {album.description || 'A curated gallery of beautiful captured moments.'}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/15 px-3 py-1.5 text-xs text-white/90 backdrop-blur-md">
              {photoCount} photo{photoCount === 1 ? '' : 's'}
            </span>

            <span className="rounded-full bg-white/15 px-3 py-1.5 text-xs text-white/90 backdrop-blur-md">
              {album.view_count || 0} views
            </span>

            <span className="rounded-full bg-blue-600/90 px-3 py-1.5 text-xs text-white shadow backdrop-blur-md">
              Cover Image
            </span>
          </div>
        </div>
      </section>

      <FaceSearchButton />

      <section className="px-4 pt-4">
        <div className="mx-auto max-w-md space-y-4">
          <PublicTopBar shareToken={token} count={photoCount} />

          {photos && photos.length > 0 ? (
            <PublicGallery
              photos={photos}
              totalCount={photoCount}
              albumTitle={album.title}
              albumId={album.id}
            />
          ) : (
            <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
              No photos in this album yet.
            </div>
          )}

          <div className="rounded-[32px] bg-white p-5 text-center shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
            <p className="text-sm font-semibold text-slate-900">Powered by Ciiya</p>
            <p className="mt-1 text-xs text-slate-500">
              Photo sharing Flashform
            </p>
          </div>
        </div>
      </section>

      <ScrollToTopButton />
    </main>
  )
}