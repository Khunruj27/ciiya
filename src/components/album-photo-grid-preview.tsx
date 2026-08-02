'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import NextImage from 'next/image'
import DeletePhotoButton from '@/components/delete-photo-button'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import {
  OPTIMISTIC_UPLOAD_EVENT,
  type OptimisticUpload,
} from '@/components/optimistic-upload'

type Photo = {
  id: string
  public_url: string

  preview_url?: string | null
  thumbnail_url?: string | null

  hd_url?: string | null
  uhd_url?: string | null

  filename?: string | null

  processing_status?: string | null
  processing_progress?: number | null

  blur_data_url?: string | null
  created_at?: string | null
}

type CameraProcessingItem = {
  id: string
  filename: string
  status: string
  progress: number
  created_at: string
}

function preloadImage(src?: string | null) {
  if (!src) return
  const img = new Image()
  img.src = src
}

function getPhotoFileKey(photo: Photo) {
  return String(photo.filename || '').toLowerCase()
}

function getOptimisticFileKey(item: OptimisticUpload) {
  return String(item.fileName || '').toLowerCase()
}

function isPhotoReady(photo: Photo) {
  return Boolean(photo.thumbnail_url || photo.preview_url)
}

function chooseBetterPhoto(livePhoto: Photo, serverPhoto?: Photo) {
  if (!serverPhoto) return livePhoto

  const liveReady = isPhotoReady(livePhoto)
  const serverReady = isPhotoReady(serverPhoto)

  if (serverReady && !liveReady) return serverPhoto
  if (liveReady && !serverReady) return livePhoto

  return {
    ...serverPhoto,
    ...livePhoto,
    thumbnail_url: livePhoto.thumbnail_url || serverPhoto.thumbnail_url,
    preview_url: livePhoto.preview_url || serverPhoto.preview_url,
    public_url: livePhoto.public_url || serverPhoto.public_url,
  }
}

// Camera upload and photo processing are two separate pipelines, each
// reporting its own 0-100 progress. Rendered back to back they looked
// like the bar reset and restarted, so this half is remapped to fill
// 0-50% of one continuous bar; the photo-worker half fills 50-100%
// (see the `progress` calc next to the SmoothProgress render below).
function getCameraProcessingProgress(item: CameraProcessingItem) {
  const progress = Number(item.progress || 0)
  const status = String(item.status || '').toLowerCase()

  let raw = progress

  if (raw <= 0) {
    if (status === 'pending') raw = 8
    else if (status === 'imported') raw = 50
    else if (status === 'uploading') raw = 70
    else if (status === 'finalizing') raw = 88
    else raw = 10
  }

  return Math.min(50, raw / 2)
}

function SmoothProgress({
  value,
  status,
}: {
  value: number
  status?: string | null
}) {
  const normalizedStatus = String(
    status || ''
  ).toLowerCase()

  const normalizedTarget = Math.max(
    0,
    Math.min(
      100,
      Number.isFinite(value)
        ? value
        : 0
    )
  )

  const fallbackTarget =
    normalizedTarget > 0
      ? normalizedTarget
      : normalizedStatus === 'pending'
        ? 8
        : normalizedStatus === 'processing'
          ? 12
          : normalizedTarget

  const [displayedProgress, setDisplayedProgress] =
    useState(fallbackTarget)

  useEffect(() => {
    const target =
      normalizedStatus === 'done'
        ? 100
        : fallbackTarget

    const timer = window.setInterval(() => {
      setDisplayedProgress((current) => {
        if (current === target) {
          window.clearInterval(timer)
          return current
        }

        const difference = target - current

        const step =
          Math.abs(difference) >= 30
            ? 3
            : Math.abs(difference) >= 10
              ? 2
              : 1

        if (difference > 0) {
          return Math.min(
            target,
            current + step
          )
        }

        return Math.max(
          target,
          current - step
        )
      })
    }, 45)

    return () => {
      window.clearInterval(timer)
    }
  }, [
    fallbackTarget,
    normalizedStatus,
  ])

  return (
    <>
      <div className="h-2 w-20 overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full bg-white transition-[width] duration-150 ease-out"
          style={{
            width: `${displayedProgress}%`,
          }}
        />
      </div>

      <div className="mt-2 text-[10px] text-white/80">
        {Math.round(displayedProgress)}%
      </div>
    </>
  )
}

export default function AlbumPhotoGridPreview({
  albumId,
  photos,
  cameraProcessingItems = [],
}: {
  albumId: string
  photos: Photo[]
  cameraProcessingItems?: CameraProcessingItem[]
}) {


  
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const loadedImagesRef = useRef<Set<string>>(new Set())
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [optimisticUploads, setOptimisticUploads] = useState<OptimisticUpload[]>([])
  const [liveCameraItems, setLiveCameraItems] = useState<CameraProcessingItem[]>([])
  const [livePhotos, setLivePhotos] = useState<Photo[]>([])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const startX = useRef(0)
  const deltaX = useRef(0)
  const scale = useRef(1)
  const lastDistance = useRef(0)

  const mergedPhotos = useMemo(() => {
  const photoMap = new Map<string, Photo>()

  for (const photo of photos) {
    photoMap.set(photo.id, photo)
  }

  for (const livePhoto of livePhotos) {
    photoMap.set(
      livePhoto.id,
      chooseBetterPhoto(livePhoto, photoMap.get(livePhoto.id))
    )
  }

  return Array.from(photoMap.values()).sort((a, b) => {
  const bTime = new Date(String(b.created_at || 0)).getTime()
  const aTime = new Date(String(a.created_at || 0)).getTime()

  if (bTime !== aTime) return bTime - aTime

  return String(b.id).localeCompare(String(a.id))
})
}, [livePhotos, photos])

const activePhoto =
  activeIndex !== null ? mergedPhotos[activeIndex] : null

useEffect(() => {

  function handlePhotoChange(row: Photo | null) {
    if (!row?.id) return

    setLivePhotos((prev) => {
      const next = prev.filter((photo) => photo.id !== row.id)
      return [row, ...next].slice(0, 120)
    })

    const filename = String(row.filename || '').toLowerCase()

    if (filename && isPhotoReady(row)) {
      setLiveCameraItems((prev) =>
        prev.filter(
          (item) =>
            String(item.filename || '').toLowerCase() !== filename
        )
      )
    }
  }

  const channel = supabase
    .channel(`album-grid-live-${albumId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'photos',
        filter: `album_id=eq.${albumId}`,
      },
      (payload) => {
        handlePhotoChange(payload.new as Photo | null)
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'photos',
        filter: `album_id=eq.${albumId}`,
      },
      (payload) => {
  const row =
    payload.new as Photo | null

  if (!row?.id) return

  handlePhotoChange(row)

  if (
    row.thumbnail_url ||
    row.preview_url
  ) {
    preloadImage(
      row.thumbnail_url ||
      row.preview_url
    )
  }
}
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}, [albumId, supabase])

const activeProcessingIds = useMemo(
  () =>
    mergedPhotos
      .filter((photo) => {
        const status = String(
          photo.processing_status || ''
        ).toLowerCase()

        return (
          status === 'pending' ||
          status === 'processing'
        )
      })
      .map((photo) => photo.id),
  [mergedPhotos]
)

useEffect(() => {
  if (activeProcessingIds.length === 0) {
    return
  }

  let cancelled = false
  let running = false

  async function refreshProcessingPhotos() {
    if (running || cancelled) return

    running = true

    try {
      const { data, error } =
        await supabase
          .from('photos')
          .select(`
            id,
            public_url,
            preview_url,
            thumbnail_url,
            hd_url,
            uhd_url,
            filename,
            processing_status,
            processing_progress,
            blur_data_url,
            created_at
          `)
          .in(
            'id',
            activeProcessingIds
          )

      if (error) {
        console.warn(
          '[album-grid] processing poll failed:',
          error.message
        )

        return
      }

      if (
        !cancelled &&
        Array.isArray(data)
      ) {
        setLivePhotos((previous) => {
          const map =
            new Map<string, Photo>()

          for (const photo of previous) {
            map.set(photo.id, photo)
          }

          for (const photo of data) {
            map.set(
              photo.id,
              chooseBetterPhoto(
                photo as Photo,
                map.get(photo.id)
              )
            )
          }

          return Array.from(
            map.values()
          ).slice(0, 120)
        })
      }
    } finally {
      running = false
    }
  }

  void refreshProcessingPhotos()

  const timer = window.setInterval(
    () => {
      void refreshProcessingPhotos()
    },
    1500
  )

  return () => {
    cancelled = true
    window.clearInterval(timer)
  }
}, [
  activeProcessingIds,
  supabase,
])

  useEffect(() => {
    function handleOptimisticUpload(event: Event) {
      const customEvent = event as CustomEvent<OptimisticUpload[]>

      setOptimisticUploads((prev) => [
  ...customEvent.detail,
  ...prev,
].slice(0, 20))
    }

    window.addEventListener(
      OPTIMISTIC_UPLOAD_EVENT,
      handleOptimisticUpload
    )

    return () => {
      window.removeEventListener(
        OPTIMISTIC_UPLOAD_EVENT,
        handleOptimisticUpload
      )
    }
  }, [])

  

  useEffect(() => {
    if (activeIndex === null) return

   preloadImage(
  mergedPhotos[activeIndex + 1]?.hd_url ||
  mergedPhotos[activeIndex + 1]?.preview_url ||
  mergedPhotos[activeIndex + 1]?.public_url
)

preloadImage(
  mergedPhotos[activeIndex - 1]?.hd_url ||
  mergedPhotos[activeIndex - 1]?.preview_url ||
  mergedPhotos[activeIndex - 1]?.public_url
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
          return Math.min(current + 1, mergedPhotos.length - 1)
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [activeIndex, mergedPhotos])

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

  const goPrev = React.useCallback(() => {
  setActiveIndex((current) => {
    if (current === null) return current

    const next = Math.max(current - 1, 0)

    if (next !== current) resetZoom()

    return next
  })
}, [])

  const goNext = React.useCallback(() => {
  setActiveIndex((current) => {
    if (current === null) return current

    const next = Math.min(current + 1, mergedPhotos.length - 1)

    if (next !== current) resetZoom()

    return next
  })
}, [mergedPhotos.length])

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

const existingPhotoKeys = useMemo(() => {
  return new Set(
    mergedPhotos
      .map(getPhotoFileKey)
      .filter(Boolean)
  )
}, [mergedPhotos])

const visibleOptimisticUploads = optimisticUploads.filter(
  (item) => !existingPhotoKeys.has(getOptimisticFileKey(item))
)

const mergedCameraItems = [
  ...liveCameraItems,
  ...cameraProcessingItems,
]
  .filter(
    (item, index, array) =>
      index === array.findIndex((other) => other.id === item.id)
  )
  .sort(
    (a, b) =>
      new Date(b.created_at).getTime() -
      new Date(a.created_at).getTime()
  )

const visibleCameraProcessingItems = mergedCameraItems
  .filter((item) => {
    const status = String(item.status || '').toLowerCase()
    const filename = String(item.filename || '').toLowerCase()

    if (!['imported', 'uploading', 'finalizing'].includes(status)) {
      return false
    }

    if (!filename) return true

    return !mergedPhotos.some((photo) => {
      return String(photo.filename || '').toLowerCase() === filename
    })
  })
  .sort(
    (a, b) =>
      new Date(b.created_at).getTime() -
      new Date(a.created_at).getTime()
  )




  return (
  <>
    <div className="grid grid-cols-4 gap-[2px] px-[2px]">
{visibleOptimisticUploads.map((item) => {
  const isError = item.status === 'error'

  return (
    <div
      key={`optimistic-${item.id}`}
      className="relative isolate overflow-hidden bg-neutral-200"
    >
      <div className="aspect-square w-full bg-gradient-to-br from-[#F0B1DE] via-[#FAF7F4] to-[#D0F578]" />

      <div
        className={`absolute inset-0 flex flex-col items-center justify-center px-1 text-center ${
          isError ? 'bg-red-500/70' : 'bg-black/20'
        }`}
      >
        <div className="line-clamp-1 text-[7px] font-bold leading-none text-white">
          {isError
            ? 'Failed'
            : item.status === 'uploading'
              ? 'Uploading'
              : item.status === 'queued'
                ? 'Queued'
                : 'Processing'}
        </div>

        {!isError && (
          <>
            <div className="mt-1 h-[2px] w-6 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-all duration-300"
                style={{
                  width: `${Math.max(8, item.progress)}%`,
                }}
              />
            </div>

            <div className="mt-0.5 text-[6px] leading-none text-white/70">
              {Math.round(item.progress)}%
            </div>
          </>
        )}
      </div>
    </div>
  )
})}

{visibleCameraProcessingItems.map((item) => {
  const progress = getCameraProcessingProgress(item)

  return (
    <div
      key={`camera-processing-${item.id}`}
      className="relative isolate aspect-square w-full overflow-hidden bg-neutral-100"
    >
      <div className="aspect-square w-full bg-gradient-to-br from-[#F0B1DE] via-[#FAF7F4] to-[#D0F578]" />

      {/* Mirrors the real photo card's processing overlay below (same
          text/bar sizing) so the handoff from this placeholder to the
          actual photo thumbnail doesn't look like a different card. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
        <div className="mb-2 text-xs font-semibold text-white">
          Processing...
        </div>

        <div className="h-2 w-20 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-150 ease-out"
            style={{
              width: `${Math.max(8, progress)}%`,
            }}
          />
        </div>

        <div className="mt-2 text-[10px] text-white/80">
          {Math.round(progress)}%
        </div>
      </div>
    </div>
  )
})}

      {mergedPhotos.map((photo, index) => {
          const imageSrc = photo.thumbnail_url || photo.preview_url || photo.public_url
          const isOriginalFallback =
            Boolean(imageSrc) && !photo.thumbnail_url && !photo.preview_url
          const status = photo.processing_status || 'done'
          // Second half of the unified bar — the camera-upload phase
          // (getCameraProcessingProgress above) already filled 0-50%.
          const progress =
            50 + Number(photo.processing_progress || 0) / 2
          const ready = isPhotoReady(photo)
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
                className="relative isolate aspect-square cursor-pointer overflow-hidden bg-neutral-100 transition active:scale-[0.98] disabled:cursor-not-allowed"
              >
                {imageSrc ? (
                  <NextImage
                    src={imageSrc}
                    fill
                    sizes="(max-width: 640px) 25vw, 16vw"
                    unoptimized={isOriginalFallback}
                    loading="lazy"
                    onLoad={() => {
  loadedImagesRef.current.add(photo.id)
}}
onError={() => {
  loadedImagesRef.current.add(photo.id)
}}
                    alt={photo.filename || 'photo'}
                    className="object-cover opacity-60"
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
              onMouseEnter={() => preloadImage(photo.hd_url || photo.preview_url || photo.public_url)}
              onTouchStart={() => preloadImage(photo.preview_url || photo.public_url)}
              className="relative isolate aspect-square cursor-pointer overflow-hidden bg-neutral-100 transition active:scale-[0.98]"
            >
              {imageSrc ? (
                <NextImage
                  src={imageSrc}
                  fill
                  sizes="(max-width: 640px) 25vw, 16vw"
                  unoptimized={isOriginalFallback}
                  loading="lazy"
                  onLoad={() => {
  loadedImagesRef.current.add(photo.id)
}}
onError={() => {
  loadedImagesRef.current.add(photo.id)
}}
                  alt={photo.filename || 'photo'}
                  className={`object-cover transition-all duration-300 ${
                    isProcessing || isRetrying ? 'opacity-70' : ''
                  }`}
                />
              ) : (
                <div className="aspect-square w-full bg-slate-200" />
              )}

              {(isProcessing || isRetrying) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                  <div className="mb-2 text-xs font-semibold text-white">
                    {isRetrying ? 'Retrying...' : 'Processing...'}
                  </div>

                  {isRetrying ? (
  <>
    <div className="h-2 w-20 overflow-hidden rounded-full bg-white/20">
      <div className="h-full bg-white transition-all duration-300" />
    </div>

    <div className="mt-2 text-[10px] text-white/80">
      Pending
    </div>
  </>
) : (
  <SmoothProgress
    value={progress}
    status={status}
  />
)}
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
            src={
    activePhoto.preview_url ||
activePhoto.hd_url ||
activePhoto.uhd_url ||
activePhoto.public_url
  }
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
            disabled={activeIndex === mergedPhotos.length - 1}
            className="absolute right-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl backdrop-blur disabled:opacity-20"
          >
            ›
          </button>

          <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/15 px-4 py-2 text-xs backdrop-blur">
            {activeIndex + 1} / {mergedPhotos.length}
          </div>
        </div>
      )}
    </>
  )
}