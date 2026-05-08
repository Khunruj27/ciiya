'use client'

import React, { useEffect, useRef, useState } from 'react'
import DeletePhotoButton from '@/components/delete-photo-button'

type Photo = {
  id: string
  public_url: string
  preview_url?: string | null
  thumbnail_url?: string | null
  filename?: string | null

  processing_status?: string | null
  processing_progress?: number | null
}

function preloadImage(src?: string | null) {
  if (!src) return

  const img = new Image()
  img.src = src
}

export default function AlbumPhotoGridPreview({
  photos,
}: {
  photos: Photo[]
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const [loadedImages, setLoadedImages] = useState<
    Record<string, boolean>
  >({})

  const containerRef = useRef<HTMLDivElement | null>(null)

  const startX = useRef(0)
  const deltaX = useRef(0)

  const scale = useRef(1)
  const lastDistance = useRef(0)

  const activePhoto =
    activeIndex !== null ? photos[activeIndex] : null

  useEffect(() => {
    if (activeIndex === null) return

    preloadImage(photos[activeIndex + 1]?.preview_url)
    preloadImage(photos[activeIndex - 1]?.preview_url)
  }, [activeIndex, photos])

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      startX.current = e.touches[0].clientX
    }

    if (e.touches.length === 2) {
      const dx =
        e.touches[0].clientX - e.touches[1].clientX

      const dy =
        e.touches[0].clientY - e.touches[1].clientY

      lastDistance.current = Math.sqrt(dx * dx + dy * dy)
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      deltaX.current =
        e.touches[0].clientX - startX.current
    }

    if (e.touches.length === 2) {
      const dx =
        e.touches[0].clientX - e.touches[1].clientX

      const dy =
        e.touches[0].clientY - e.touches[1].clientY

      const dist = Math.sqrt(dx * dx + dy * dy)

      const diff = dist - lastDistance.current

      scale.current = Math.min(
        3,
        Math.max(1, scale.current + diff * 0.005)
      )

      lastDistance.current = dist

      if (containerRef.current) {
        containerRef.current.style.transform = `scale(${scale.current})`
      }
    }
  }

  function handleTouchEnd() {
    if (deltaX.current > 80) {
      setActiveIndex((i) => (i ? i - 1 : i))
    }

    if (deltaX.current < -80) {
      setActiveIndex((i) =>
        i !== null
          ? Math.min(i + 1, photos.length - 1)
          : i
      )
    }

    deltaX.current = 0
  }

  return (
    <>
      {/* GRID */}
      <div className="grid grid-cols-3 gap-[2px] px-[2px]">
        {photos.map((photo, index) => {
          const imageSrc =
            photo.thumbnail_url ||
            photo.preview_url ||
            photo.public_url

          const status = photo.processing_status || 'completed'

          const progress =
            photo.processing_progress || 0

          const isLoaded = loadedImages[photo.id]

          const isProcessing =
            status === 'pending' ||
            status === 'processing'

          const isFailed = status === 'failed'

          return (
            <div
              key={photo.id}
              onClick={() => setActiveIndex(index)}
              onMouseEnter={() =>
                preloadImage(
                  photo.preview_url || photo.public_url
                )
              }
              onTouchStart={() =>
                preloadImage(
                  photo.preview_url || photo.public_url
                )
              }
              className="relative cursor-pointer overflow-hidden bg-neutral-100 active:scale-[0.98] transition"
            >
              {/* image */}
              <img
                src={imageSrc}
                loading="lazy"
                onLoad={() =>
                  setLoadedImages((prev) => ({
                    ...prev,
                    [photo.id]: true,
                  }))
                }
                className={`
                  aspect-square
                  w-full
                  object-cover
                  transition-all
                  duration-300
                  ${!isLoaded ? '' : ''}
                  ${isProcessing ? 'opacity-70' : ''}
                `}
              />

              {/* loading overlay */}
              {isProcessing && (
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center">
                  <div className="mb-2 text-xs font-semibold text-white">
                    Processing...
                  </div>

                  <div className="h-2 w-20 overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full bg-white transition-all duration-300"
                      style={{
                        width: `${progress}%`,
                      }}
                    />
                  </div>

                  <div className="mt-2 text-[10px] text-white/80">
                    {progress}%
                  </div>
                </div>
              )}

              {/* failed */}
              {isFailed && (
                <div className="absolute inset-0 bg-red-500/70 flex items-center justify-center">
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-red-600">
                    FAILED
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* FULLSCREEN */}
      {activeIndex !== null && activePhoto && (
        <div className="fixed inset-0 z-[999] bg-black text-white">
          {/* HEADER */}
          <div className="absolute top-0 left-0 right-0 z-20 flex justify-between p-4">
            <button
              onClick={() => setActiveIndex(null)}
              className="rounded-full bg-black/50 px-3 py-2 backdrop-blur"
            >
              ✕
            </button>

            <DeletePhotoButton photoId={activePhoto.id} />
          </div>

          {/* IMAGE */}
          <div
            ref={containerRef}
            className="flex h-full items-center justify-center transition-transform duration-100"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <img
              src={
                activePhoto.preview_url ||
                activePhoto.public_url
              }
              className="max-h-full max-w-full object-contain select-none"
              draggable={false}
            />
          </div>
        </div>
      )}
    </>
  )
}