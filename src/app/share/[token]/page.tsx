import { cookies } from 'next/headers'
import Image from 'next/image'
import PublicGalleryInfinite from '@/components/public-gallery-infinite'
import ShareViewTracker from '@/components/share-view-tracker'
import ScrollToTopButton from '@/components/scroll-to-top-button'
import SelfieFaceSearch from '@/components/selfie-face-search'
import SharePasswordGate from '@/components/share-password-gate'
import ShareGalleryTabs from '@/components/share-gallery-tabs'
import {
  getSharedAlbumByToken,
  getSharedAlbumPhotos,
  getPhotographerContact,
  getAlbumLikeTotal,
  getGuestMomentCount,
} from '@/lib/share-data'
import {
  getShareAuthCookieName,
  hasValidSharePasswordAccess,
  isAlbumPubliclyVisible,
} from '@/lib/share-access'
import { facebookUrl, telUrl, displayHandle } from '@/lib/portfolio-links'
import { getServerDictionary } from '@/lib/i18n-server'

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
  const { t } = await getServerDictionary()

  let album: Awaited<ReturnType<typeof getSharedAlbumByToken>> | null = null

  try {
    album = await getSharedAlbumByToken(token)
  } catch (error) {
    console.error('[share page] album lookup failed:', error)
  }

  if (!album || !isAlbumPubliclyVisible(album)) {
    return (
      <main className="min-h-screen bg-ground px-4 py-10 text-ink">
        <div className="mx-auto max-w-[430px] rounded-hero border border-line bg-surface p-7 shadow-card">
          <p className="text-[13px] font-medium text-muted">
            {t.share.ciiyaGallery}
          </p>

          <h1 className="mt-3 text-[30px] font-bold tracking-[-0.045em]">
            {t.share.notFound}
          </h1>

          <p className="mt-3 text-[14px] font-normal leading-6 text-muted">
            {t.share.notFoundSub}
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

  const contact = await getPhotographerContact(album.owner_id || album.user_id)
  const hasContact = Boolean(contact.facebook || contact.phone)

  const galleryLikeTotal = await getAlbumLikeTotal(album.id)
  const momentCount = await getGuestMomentCount(album.id)

  // The photographer's contact card. Passed into the tabs so it sits at the
  // foot of both the Gallery and the Moments view.
  const contactCard = hasContact ? (
    <section className="overflow-hidden rounded-hero border border-line bg-surface shadow-card">
      <div className="relative px-5 py-7 sm:px-8 sm:py-9">
        <div aria-hidden className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-gold/20 blur-3xl" />
        <div className="relative flex flex-col items-center gap-6 text-center">
          <div className="max-w-xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-deep">
              {t.share.contactEyebrow}
            </p>
            <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.035em] sm:text-[38px]">
              {t.share.contactHeading}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[13px] leading-6 text-muted sm:text-[14px]">
              {t.share.contactSub}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {contact.phone ? (
              <a
                href={telUrl(contact.phone)}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-[13px] font-semibold text-white shadow-float transition active:scale-95"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4">
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7A2 2 0 0 1 22 16.9Z" />
                </svg>
                {contact.phone}
              </a>
            ) : null}

            {contact.facebook ? (
              <a
                href={facebookUrl(contact.facebook)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-line-strong bg-surface px-6 text-[13px] font-semibold text-ink transition hover:border-ink/25 active:scale-95"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-[22px] w-[22px] text-[#1877F2]">
                  <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
                </svg>
                {displayHandle(contact.facebook)}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  ) : null

  const visiblePhotos = photos

  const initialCursor =
    visiblePhotos.length > 0
      ? visiblePhotos[visiblePhotos.length - 1].created_at
      : null

  return (
   <main className="min-h-screen bg-ground text-ink">
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
            alt={album.title || t.share.albumCover}
            fill
            sizes="100vw"
            priority
            unoptimized
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-gold via-gold-deep to-ink" />
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/20 to-black/78" />

        {/* Overlay text keeps the container's gutters so it lines up with the
            gallery below instead of hugging the screen edge. */}
        <div className="absolute inset-x-0 top-0">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 pt-4 sm:px-6 sm:pt-5 lg:px-8">
            <div className="rounded-full bg-white/18 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-xl sm:px-4 sm:py-2 sm:text-[12px]">
              {t.share.galleryPill}
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-white/18 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-xl sm:px-4 sm:py-2 sm:text-[12px]">
              <span className="h-1.5 w-1.5 rounded-full bg-rose" />
              {t.share.onlineAlbum}
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto w-full max-w-5xl px-4 pb-4 text-center sm:px-6 sm:pb-5 lg:px-8">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70 sm:text-[11px]">
              {t.share.sharedAlbum}
            </p>
            {/*
              The title block is anchored to the bottom of the cover, so an
              unclamped title grows upward: a real two-line Thai album name
              ran 29px into the pills on a landscape phone. Clamping the
              lines caps that growth, and on short viewports the type shrinks
              and the description steps aside to leave room.
            */}
            <h1 className="mt-1.5 line-clamp-2 text-[clamp(1.75rem,1.1rem+2.4vw,2.75rem)] font-bold leading-[0.98] tracking-[-0.04em] text-white text-balance [@media(max-height:480px)]:text-[1.5rem] sm:mt-2">
              {album.title}
            </h1>
            <p className="mt-1.5 line-clamp-2 text-[12px] font-normal leading-snug text-white/80 [@media(max-height:480px)]:hidden sm:mt-2 sm:text-[14px]">
              {album.description || 'View and download photos from this job with ease'}
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
          <ShareGalleryTabs token={token} contact={contactCard} initialGalleryLikes={galleryLikeTotal} initialMomentCount={momentCount}>
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
                <div className="rounded-hero border border-line bg-surface px-7 py-14 text-center">
                  <p className="text-[20px] font-semibold tracking-[-0.03em] text-ink">
                    {t.share.noPhotos}
                  </p>

                  <p className="mt-2 text-[14px] font-normal leading-6 text-muted">
                    {t.share.noPhotosSub}
                  </p>
                </div>
              )}
            </div>
          </ShareGalleryTabs>

           {/* FOOTER */}
        <footer className="text-center">
          <p className="pt-5 text-[12px] font-medium text-muted">
             {t.share.madeWith}
          </p>
          <p className="text-[10px] font-normal text-muted/80">
              {t.share.footerTag}
            </p>
        </footer>
        </div>
      </section>

      </div>

      <ScrollToTopButton />
    </main>
  )
}
