'use client'

import React, { useEffect, useRef, useState } from 'react'
import DeletePhotoButton from '@/components/delete-photo-button'
import { useRouter } from 'next/navigation'

type Photo = {
  id: string
  public_url: string
  preview_url?: string | null
  thumbnail_url?: string | null
  filename?: string | null
  processing_status?: string | null
  processing_progress?: number | null
  blur_data_url?: string | null
}

function preloadImage(src?: string | null) {
  if (!src) return
  const img = new Image()
  img.src = src
}

function isPhotoReady(photo: Photo) {
  return Boolean(photo.thumbnail_url || photo.preview_url)
}

export default function AlbumPhotoGridPreview({ photos }: { photos: Photo[] }) {
  const router = useRouter()

  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({})
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const startX = useRef(0)
  const deltaX = useRef(0)
  const scale = useRef(1)
  const lastDistance = useRef(0)

  const activePhoto = activeIndex !== null ? photos[activeIndex] : null

  useEffect(() => {
    if (activeIndex === null) return

    preloadImage(
      photos[activeIndex + 1]?.preview_url || photos[activeIndex + 1]?.public_url
    )
    preloadImage(
      photos[activeIndex - 1]?.preview_url || photos[activeIndex - 1]?.public_url
    )

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setActiveIndex(null)

      if (e.key === 'ArrowLeft') {
        setActiveIndex((current) => {
          if (current === null) return current
          return Math.max(current - 1, 0)
        })
      }

      if (e.key === 'ArrowRight') {
        setActiveIndex((current) => {
          if (current === null) return current
          return Math.min(current + 1, photos.length - 1)
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [activeIndex, photos])

  async function retryProcessing(photoId: string) {
    try {
      setRetryingId(photoId)

      const res = await fetch('/api/photos/retry-processing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ photoId }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        alert(data?.error || 'Retry failed')
        return
      }

      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Retry failed')
    } finally {
      setRetryingId(null)
    }
  }

   
  function resetZoom() {
    scale.current = 1

    if (containerRef.current) {
      containerRef.current.style.transform = 'scale(1)'
    }
  }

  function goPrev() {
    setActiveIndex((current) => {
      if (current === null) return current

      const next = Math.max(current - 1, 0)

      if (next !== current) resetZoom()

      return next
    })
  }

  function goNext() {
    setActiveIndex((current) => {
      if (current === null) return current

      const next = Math.min(current + 1, photos.length - 1)

      if (next !== current) resetZoom()

      return next
    })
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      startX.current = e.touches[0].clientX
    }

    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY

      lastDistance.current = Math.sqrt(dx * dx + dy * dy)
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      deltaX.current = e.touches[0].clientX - startX.current
    }

    if (e.touches.length === 2) {
      e.preventDefault()

      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const diff = dist - lastDistance.current

      scale.current = Math.min(3, Math.max(1, scale.current + diff * 0.005))
      lastDistance.current = dist

      if (containerRef.current) {
        containerRef.current.style.transform = `scale(${scale.current})`
      }
    }
  }

  function handleTouchEnd() {
    if (scale.current <= 1.05) {
      if (deltaX.current > 80) goPrev()
      if (deltaX.current < -80) goNext()
    }

    deltaX.current = 0
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-[2px] px-[2px]">
        {photos.map((photo, index) => {
          const imageSrc = photo.thumbnail_url || photo.preview_url || photo.public_url
          const status = photo.processing_status || 'done'
          const progress = Number(photo.processing_progress || 0)
          const ready = isPhotoReady(photo)
          const isLoaded = loadedImages[photo.id]
          const isRetrying = retryingId === photo.id

          const isFailed = status === 'failed' && !ready
          const isProcessing =
            !ready && (status === 'pending' || status === 'processing')

          if (isFailed) {
            return (
              <button
                key={photo.id}
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  retryProcessing(photo.id)
                }}
                disabled={isRetrying}
                className="relative isolate cursor-pointer overflow-hidden bg-neutral-100 transition active:scale-[0.98] disabled:cursor-not-allowed"
              >
                {imageSrc ? (
                  <img
                    src={imageSrc}
                    loading="lazy"
                    onLoad={() =>
                      setLoadedImages((prev) => ({
                        ...prev,
                        [photo.id]: true,
                      }))
                    }
                    onError={() =>
                      setLoadedImages((prev) => ({
                        ...prev,
                        [photo.id]: true,
                      }))
                    }
                    alt={photo.filename || 'photo'}
                    className="aspect-square w-full object-cover opacity-60"
                  />
                ) : (
                  <div className="aspect-square w-full bg-slate-200" />
                )}

                <div className="absolute inset-0 flex items-center justify-center bg-red-500/70">
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-red-600">
                    {isRetrying ? 'RETRYING...' : 'FAILED · Retry'}
                  </div>
                </div>
              </button>
            )
          }

          return (
            <div
              key={photo.id}
              onClick={() => {
                if (isProcessing) return
                resetZoom()
                setActiveIndex(index)
              }}
              onMouseEnter={() => preloadImage(photo.preview_url || photo.public_url)}
              onTouchStart={() => preloadImage(photo.preview_url || photo.public_url)}
              className="relative isolate cursor-pointer overflow-hidden bg-neutral-100 transition active:scale-[0.98]"
            >
              {imageSrc ? (
                <img
                  src={imageSrc}
                  loading="lazy"
                  onLoad={() =>
                    setLoadedImages((prev) => ({
                      ...prev,
                      [photo.id]: true,
                    }))
                  }
                  onError={() =>
                    setLoadedImages((prev) => ({
                      ...prev,
                      [photo.id]: true,
                    }))
                  }
                  alt={photo.filename || 'photo'}
                  className={`aspect-square w-full object-cover transition-all duration-300 ${
                    isProcessing || isRetrying ? 'opacity-70' : ''
                  }`}
                />
              ) : (
                <div className="aspect-square w-full bg-slate-200" />
              )}

              {!isLoaded && !isProcessing && (
                <div className="pointer-events-none absolute inset-0 -z-10 bg-slate-100" />
              )}

              {(isProcessing || isRetrying) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                  <div className="mb-2 text-xs font-semibold text-white">
                    {isRetrying ? 'Retrying...' : 'Processing...'}
                  </div>

                  <div className="h-2 w-20 overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full bg-white transition-all duration-300"
                      suppressHydrationWarning
                      style={{
                        width: `${progress}%`,
                      }}
                    />
                  </div>

                  <div className="mt-2 text-[10px] text-white/80">
                    {isRetrying ? 'Pending' : `${progress}%`}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {activeIndex !== null && activePhoto && (
        <div className="fixed inset-0 z-[999] bg-black text-white">
          <div className="absolute left-0 right-0 top-0 z-20 flex justify-between p-4">
            <button
              onClick={() => setActiveIndex(null)}
              className="rounded-full bg-black/50 px-3 py-2 backdrop-blur"
            >
              ✕
            </button>

            <DeletePhotoButton photoId={activePhoto.id} />
          </div>

          <div
            ref={containerRef}
            className="flex h-full items-center justify-center transition-transform duration-100"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <img
              src={activePhoto.preview_url || activePhoto.public_url}
              className="max-h-full max-w-full select-none object-contain"
              draggable={false}
              alt={activePhoto.filename || 'photo'}
            />
          </div>

          <button
            type="button"
            onClick={goPrev}
            disabled={activeIndex === 0}
            className="absolute left-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl backdrop-blur disabled:opacity-20"
          >
            ‹
          </button>

          <button
            type="button"
            onClick={goNext}
            disabled={activeIndex === photos.length - 1}
            className="absolute right-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl backdrop-blur disabled:opacity-20"
          >
            ›
          </button>

          <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/15 px-4 py-2 text-xs backdrop-blur">
            {activeIndex + 1} / {photos.length}
          </div>
        </div>
      )}
    </>
  )
}