'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, type TouchEvent } from 'react'
import type { Portfolio } from '@/lib/portfolio-types'
import { useI18n } from '@/components/i18n-provider'
import PortfolioGalleryLayout from './portfolio-gallery-layout'

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

  return (
    <>
      <PortfolioGalleryLayout
        images={images}
        layout={layout}
        photoLabel={index => t.portfolioGallery.openPhoto(index + 1, ownerName)}
        onSelect={openImage}
      />

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


function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden className="h-5 w-5"><path d="m6 6 12 12M18 6 6 18" /></svg>
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5"><path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>
}
