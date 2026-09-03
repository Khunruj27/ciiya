'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, type TouchEvent } from 'react'
import type { Portfolio } from '@/lib/portfolio-types'
import { useI18n } from '@/components/i18n-provider'

type GalleryLayout = Portfolio['gallery_layout']

type PortfolioGalleryProps = {
  images: string[]
  layout: GalleryLayout
  ownerName: string
}

export default function PortfolioGallery({
  images,
  layout,
  ownerName,
}: PortfolioGalleryProps) {
  const { t } = useI18n()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const touchStartXRef = useRef<number | null>(null)

  function openImage(index: number) {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    setActiveIndex(index)
  }

  function closeViewer() {
    setActiveIndex(null)
    requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  function showPrevious() {
    setActiveIndex((current) =>
      current === null ? null : (current - 1 + images.length) % images.length
    )
  }

  function showNext() {
    setActiveIndex((current) =>
      current === null ? null : (current + 1) % images.length
    )
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = event.touches[0]?.clientX ?? null
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartXRef.current
    const endX = event.changedTouches[0]?.clientX
    touchStartXRef.current = null
    if (startX === null || endX === undefined || Math.abs(startX - endX) < 50) return
    if (startX > endX) showNext()
    else showPrevious()
  }

  useEffect(() => {
    if (activeIndex === null) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveIndex(null)
        requestAnimationFrame(() => returnFocusRef.current?.focus())
      }
      if (event.key === 'ArrowLeft') {
        setActiveIndex((current) =>
          current === null ? null : (current - 1 + images.length) % images.length
        )
      }
      if (event.key === 'ArrowRight') {
        setActiveIndex((current) =>
          current === null ? null : (current + 1) % images.length
        )
      }
    }

    closeButtonRef.current?.focus()
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeIndex, images.length])

  const isCollage = layout.startsWith('collage')
  const containerClass =
    layout === 'grid'
      ? 'grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4'
      : layout === 'masonry'
        ? 'columns-2 gap-2 sm:columns-3 sm:gap-4'
        : layout === 'collage_overlap'
          ? 'pf-gallery-scroll flex snap-x snap-mandatory items-center overflow-x-auto py-8 pl-5 pr-[28vw] sm:py-12 sm:pl-10'
          : layout === 'collage_frames'
            ? 'flex flex-col gap-7 bg-[#eee7dc] px-4 py-8 sm:gap-12 sm:px-10 sm:py-14'
        : isCollage
          ? 'grid grid-cols-4 auto-rows-[24vw] gap-2 sm:auto-rows-[16vw] sm:gap-4 lg:auto-rows-[180px]'
        : layout === 'carousel'
          ? 'pf-gallery-scroll flex snap-x snap-mandatory gap-0 overflow-x-auto pb-3'
          : 'pf-gallery-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 sm:gap-5'

  return (
    <>
      <div className={containerClass}>
        {images.map((url, index) => {
          const frameClass =
            layout === 'grid'
              ? `${index % 5 === 0 ? 'col-span-2 aspect-[16/10] sm:col-span-1 sm:aspect-[4/5]' : 'aspect-[4/5]'}`
              : layout === 'masonry'
                ? `${['aspect-[3/4]', 'aspect-square', 'aspect-[4/5]'][index % 3]} mb-2 break-inside-avoid sm:mb-4`
                : layout === 'collage'
                  ? ['col-span-3 row-span-2', 'col-span-1 row-span-1', 'col-span-1 row-span-1', 'col-span-2 row-span-2', 'col-span-2 row-span-1', 'col-span-2 row-span-1'][index % 6]
                  : layout === 'collage_story'
                    ? ['col-span-2 row-span-3', 'col-span-2 row-span-1', 'col-span-1 row-span-2', 'col-span-1 row-span-2', 'col-span-3 row-span-2', 'col-span-1 row-span-2'][index % 6]
                    : layout === 'collage_panorama'
                      ? ['col-span-4 row-span-2', 'col-span-2 row-span-2', 'col-span-2 row-span-1', 'col-span-1 row-span-1', 'col-span-1 row-span-1'][index % 5]
                    : layout === 'collage_tiles'
                        ? ['col-span-2 row-span-2', 'col-span-2 row-span-1', 'col-span-1 row-span-2', 'col-span-1 row-span-1', 'col-span-2 row-span-2', 'col-span-1 row-span-1'][index % 6]
                      : layout === 'collage_overlap'
                        ? `aspect-[3/4] w-[72vw] shrink-0 snap-center border-[7px] border-white shadow-[0_18px_50px_rgba(23,21,18,0.18)] sm:w-[42vw] ${index === 0 ? '' : '-ml-[24vw] sm:-ml-[12vw]'} ${index % 2 ? 'rotate-[2deg]' : '-rotate-[2deg]'}`
                      : layout === 'collage_frames'
                        ? `aspect-[4/5] w-[86%] border-[10px] border-white shadow-[0_14px_38px_rgba(69,55,38,0.14)] sm:w-[68%] sm:border-[16px] ${index % 2 ? 'self-end rotate-[1.5deg]' : 'self-start -rotate-[1.5deg]'}`
                : layout === 'filmstrip'
                  ? 'aspect-[16/10] w-[88vw] shrink-0 snap-center sm:w-[64vw] lg:w-[48vw]'
                  : 'aspect-[4/5] w-[92vw] shrink-0 snap-center rounded-none sm:w-[70vw] lg:w-[52vw]'

          return (
            <button
              key={`${url}-${index}`}
              type="button"
              onClick={() => openImage(index)}
              className={`group relative block overflow-hidden rounded-[10px] bg-ground-sunken text-left ring-1 ring-ink/[0.06] ${frameClass}`}
              aria-label={t.portfolioGallery.openPhoto(index + 1, ownerName)}
            >
              <Image
                src={url}
                alt={t.portfolioGallery.photoAlt(ownerName, index + 1)}
                fill
                unoptimized
                sizes={
                  layout === 'grid' || layout === 'masonry' || (isCollage && layout !== 'collage_overlap' && layout !== 'collage_frames')
                    ? '(max-width: 640px) 50vw, 33vw'
                    : layout === 'collage_overlap' || layout === 'collage_frames'
                      ? '(max-width: 640px) 86vw, 68vw'
                    : layout === 'filmstrip'
                      ? '(max-width: 640px) 88vw, (max-width: 1024px) 64vw, 48vw'
                      : '(max-width: 640px) 76vw, (max-width: 1024px) 42vw, 30vw'
                }
                className="object-cover transition duration-[900ms] ease-out group-hover:scale-[1.035]"
              />

              {/* A magazine plate number and an open cue, revealed under a soft
                  scrim on hover. The serif index ties the gallery back to the
                  editorial headings. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0f0e0c]/55 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100"
              />
              <span className="pf-serif pointer-events-none absolute bottom-2.5 left-3.5 text-[15px] font-medium italic text-white opacity-0 transition duration-500 group-hover:opacity-100">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="pointer-events-none absolute bottom-3 right-3 grid h-8 w-8 translate-y-1.5 place-items-center rounded-full bg-white/15 text-white opacity-0 backdrop-blur-md transition duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                <ExpandIcon />
              </span>
            </button>
          )
        })}
      </div>

      {activeIndex !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.portfolioGallery.viewFullScreen}
          className="fixed inset-0 z-[100] bg-[#0b0b0b]/96 text-white"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-[max(16px,env(safe-area-inset-top))] sm:px-7">
            <p className="text-[12px] font-medium tracking-[0.08em] text-white/65">
              {String(activeIndex + 1).padStart(2, '0')} / {String(images.length).padStart(2, '0')}
            </p>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeViewer}
              className="grid h-11 w-11 place-items-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20"
              aria-label={t.portfolioGallery.closePhoto}
            >
              <CloseIcon />
            </button>
          </div>

          <div className="absolute inset-0 px-4 py-20 sm:px-20 sm:py-16">
            <Image
              src={images[activeIndex]}
              alt={t.portfolioGallery.photoAlt(ownerName, activeIndex + 1)}
              fill
              unoptimized
              sizes="100vw"
              className="object-contain p-4 sm:p-16"
              priority
            />
          </div>

          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={showPrevious}
                className="absolute left-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20 sm:left-7"
                aria-label={t.portfolioGallery.prevPhoto}
              >
                <ChevronIcon direction="left" />
              </button>
              <button
                type="button"
                onClick={showNext}
                className="absolute right-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20 sm:right-7"
                aria-label={t.portfolioGallery.nextPhoto}
              >
                <ChevronIcon direction="right" />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function ExpandIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden className="h-5 w-5"><path d="m6 6 12 12M18 6 6 18" /></svg>
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5"><path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>
}
