import { cookies } from 'next/headers'
import Image from 'next/image'
import PublicGalleryInfinite from '@/components/public-gallery-infinite'
import ShareViewTracker from '@/components/share-view-tracker'
import ScrollToTopButton from '@/components/scroll-to-top-button'
import SelfieFaceSearch from '@/components/selfie-face-search'
import SharePasswordGate from '@/components/share-password-gate'
import { getSharedAlbumByToken, getSharedAlbumPhotos } from '@/lib/share-data'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'

// The page itself stays dynamic (it reads the visitor's password-access
// cookie fresh on every request), but the underlying album/photos
// queries are cached for SHARE_CACHE_TTL_SECONDS via unstable_cache in
// share-data.ts — so many concurrent viewers within that window share
// one DB round trip instead of one each.
export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ token: string }>
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params

  let album: Awaited<ReturnType<typeof getSharedAlbumByToken>> | null = null

  try {
    album = await getSharedAlbumByToken(token)
  } catch (error) {
    console.error('[share page] album lookup failed:', error)
  }

  if (!album || !isAlbumPubliclyVisible(album)) {
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

  const cookieStore = await cookies()
  const shareCookie = cookieStore.get(getShareAuthCookieName(album.id))?.value

  if (!hasValidSharePasswordAccess(album, shareCookie)) {
    return <SharePasswordGate token={token} albumTitle={album.title} />
  }

  const { photos, photoCount } = await getSharedAlbumPhotos(album.id)

  const visiblePhotos = photos

  const initialCursor =
    visiblePhotos.length > 0
      ? visiblePhotos[visiblePhotos.length - 1].created_at
      : null

  return (
   <main className="min-h-screen bg-[#FAF7F4] text-[#1C0617]">
      <ShareViewTracker token={token} />

      {/*
        HERO — full bleed. It sits outside the padded container so the cover
        runs edge to edge with no card, border, or corner radius around it.
        Height tracks the viewport and is deliberately shorter than the rest
        of the page's rhythm on phones, where a tall cover pushed the photos
        themselves below the fold.
      */}
      <section className="relative h-[30vh] max-h-[360px] min-h-[170px] w-full overflow-hidden bg-black sm:h-[34vh] sm:max-h-[440px]">
        {album.cover_url ? (
          <Image
            src={album.cover_url}
            alt={album.title || 'Album cover'}
            fill
            sizes="100vw"
            priority
            unoptimized
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-[#72D8FF] via-[#5B8CFF] to-[#315BFF]" />
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/20 to-black/78" />

        {/* Overlay text keeps the container's gutters so it lines up with the
            gallery below instead of hugging the screen edge. */}
        <div className="absolute inset-x-0 top-0">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 pt-4 sm:px-6 sm:pt-5 lg:px-8">
            <div className="rounded-full bg-white/18 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-xl sm:px-4 sm:py-2 sm:text-[12px]">
              Gallery
            </div>
            <div className="rounded-full bg-white/18 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-xl sm:px-4 sm:py-2 sm:text-[12px]">
              Live album
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto w-full max-w-5xl px-4 pb-4 sm:px-6 sm:pb-5 lg:px-8">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/70 sm:text-[12px]">
              Shared Album
            </p>
            {/*
              The title block is anchored to the bottom of the cover, so an
              unclamped title grows upward: a real two-line Thai album name
              ran 29px into the pills on a landscape phone. Clamping the
              lines caps that growth, and on short viewports the type shrinks
              and the description steps aside to leave room.
            */}
            <h1 className="mt-1.5 line-clamp-2 text-[clamp(1.75rem,1.1rem+2.4vw,2.75rem)] font-black leading-[0.95] tracking-[-0.05em] text-white text-balance [@media(max-height:480px)]:text-[1.5rem] sm:mt-2">
              {album.title}
            </h1>
            <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-white/75 [@media(max-height:480px)]:hidden sm:mt-2 sm:text-[14px]">
              {album.description || 'View and download your event photos'}
            </p>
          </div>
        </div>
      </section>

      {/* No top padding here — the CONTENT section below already carries it,
          and doubling them left a wide gap under the full-bleed cover. */}
      <div className="mx-auto w-full max-w-5xl px-4 pb-5 sm:px-6 sm:pb-6 lg:px-8">

      {/* CONTENT */}
      <section className="pb-12 pt-5">
        <div className="space-y-5">
          <SelfieFaceSearch albumId={album.id} token={token} />

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

           {/* FOOTER */}
        <footer className="text-center">
          <p className="pt-5 text-[13px] font-semibold text-[#B0A6AB]">
             Powered by Ciiya app
          </p>
          <p className="text-[10px] font-medium text-[#8E8E93]">
              Photos sharing platform
            </p>
        </footer>
        </div>
      </section>

      </div>

      <ScrollToTopButton />
    </main>
  )
}
