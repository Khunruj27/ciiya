'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Grid2Icon,
  Grid3Icon,
  Grid4Icon,
} from '@/components/gallery-grid-icons'

type Photo = {
  id: string
  public_url: string
  preview_url?: string | null
  thumbnail_url?: string | null
  filename?: string | null
  view_count?: number | null
}

type Props = {
  photos: Photo[]
  totalCount?: number
  albumTitle?: string
  albumId?: string
}

type TouchPoint = {
  x: number
  y: number
}

function getDistance(a: TouchPoint, b: TouchPoint) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function getRankLabel(index: number) {
  const rank = index + 1
  if (rank <= 3) return `TOP ${rank}`
  if (rank <= 10) return `#${rank}`
  return null
}

function getRankClass(index: number) {
  const rank = index + 1
  if (rank === 1) return 'bg-yellow-400 text-black'
  if (rank === 2) return 'bg-slate-300 text-black'
  if (rank === 3) return 'bg-orange-400 text-white'
  return 'bg-black/65 text-white'
}

function getSafeGridCols(value: number) {
  if (value === 2 || value === 3 || value === 4) return value
  return 3
}

export default function PublicGallery({
  photos: initialPhotos,
  totalCount = initialPhotos.length,
  albumId,
}: Props) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [tab, setTab] = useState<'live' | 'popular'>('live')
  const [scale, setScale] = useState(1)
  const [lastTap, setLastTap] = useState(0)
  const [gridCols, setGridCols] = useState(3)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialPhotos.length < totalCount)

  const viewerRef = useRef<HTMLDivElement>(null)
  const pinchStartDistance = useRef<number | null>(null)
  const startScale = useRef(1)

  const popularPhotos = useMemo(() => {
    return [...photos].sort((a, b) => {
      const aViews = Number(a.view_count || 0)
      const bViews = Number(b.view_count || 0)

      if (bViews !== aViews) return bViews - aViews
      return a.id.localeCompare(b.id)
    })
  }, [photos])

  const displayPhotos = tab === 'live' ? photos : popularPhotos
  const activePhoto = activeIndex !== null ? displayPhotos[activeIndex] : null

  useEffect(() => {
    setPhotos(initialPhotos)
    setHasMore(initialPhotos.length < totalCount)
  }, [initialPhotos, totalCount])

  useEffect(() => {
    const savedCols = Number(localStorage.getItem('public-gallery-cols') || 3)
    setGridCols(getSafeGridCols(savedCols))
  }, [])

  useEffect(() => {
    localStorage.setItem('public-gallery-cols', String(gridCols))
  }, [gridCols])

  useEffect(() => {
    if (activeIndex !== null && viewerRef.current) {
      const width = viewerRef.current.clientWidth

      requestAnimationFrame(() => {
        viewerRef.current?.scrollTo({
          left: width * activeIndex,
          behavior: 'instant',
        })
      })

      setScale(1)
    }
  }, [activeIndex])

  useEffect(() => {
    if (activeIndex === null) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setActiveIndex(null)

      if (e.key === 'ArrowRight') {
        setActiveIndex((current) => {
          if (current === null) return current
          return Math.min(current + 1, displayPhotos.length - 1)
        })
      }

      if (e.key === 'ArrowLeft') {
        setActiveIndex((current) => {
          if (current === null) return current
          return Math.max(current - 1, 0)
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [activeIndex, displayPhotos.length])

  async function loadMore() {
    if (!albumId || loadingMore || !hasMore) return

    try {
      setLoadingMore(true)

      const from = photos.length
      const to = from + 49

      const res = await fetch(
        `/api/share/photos?albumId=${albumId}&from=${from}&to=${to}`,
        {
          cache: 'no-store',
        }
      )

      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) return

      const nextPhotos = data.photos || []

      setPhotos((prev) => {
        const existing = new Set(prev.map((photo) => photo.id))
        const unique = nextPhotos.filter((photo: Photo) => !existing.has(photo.id))
        return [...prev, ...unique]
      })

      if (nextPhotos.length < 50 || photos.length + nextPhotos.length >= totalCount) {
        setHasMore(false)
      }
    } finally {
      setLoadingMore(false)
    }
  }

  function goPrev() {
    setActiveIndex((current) => {
      if (current === null) return current
      return Math.max(current - 1, 0)
    })
  }

  function goNext() {
    setActiveIndex((current) => {
      if (current === null) return current
      return Math.min(current + 1, displayPhotos.length - 1)
    })
  }

  function handleDoubleTap() {
    const now = Date.now()

    if (now - lastTap < 280) {
      setScale((current) => (current > 1 ? 1 : 2.4))
    }

    setLastTap(now)
  }

  function handleTouchStart(e: React.TouchEvent<HTMLImageElement>) {
    if (e.touches.length === 2) {
      const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY }

      pinchStartDistance.current = getDistance(p1, p2)
      startScale.current = scale
    }
  }

  function handleTouchMove(e: React.TouchEvent<HTMLImageElement>) {
    if (e.touches.length === 2 && pinchStartDistance.current) {
      e.preventDefault()

      const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY }

      const currentDistance = getDistance(p1, p2)
      const nextScale =
        startScale.current * (currentDistance / pinchStartDistance.current)

      setScale(Math.min(4, Math.max(1, nextScale)))
    }
  }

  function handleTouchEnd() {
    pinchStartDistance.current = null

    if (scale < 1.05) {
      setScale(1)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-6">
            <button type="button" onClick={() => setTab('live')}>
              <p
                className={`text-sm font-semibold ${
                  tab === 'live' ? 'text-[#2F6BFF]' : 'text-slate-500'
                }`}
              >
                Live Photos
              </p>
              {tab === 'live' ? (
                <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-[#2F6BFF]" />
              ) : null}
            </button>

            <button type="button" onClick={() => setTab('popular')}>
              <p
                className={`text-sm font-semibold ${
                  tab === 'popular' ? 'text-[#2F6BFF]' : 'text-slate-500'
                }`}
              >
                Popular🔥
              </p>
              {tab === 'popular' ? (
                <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-[#2F6BFF]" />
              ) : null}
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 p-1">
            {[2, 3, 4].map((cols) => (
              <button
                key={cols}
                type="button"
                onClick={() => setGridCols(cols)}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 active:scale-90 ${
                  gridCols === cols
                    ? 'bg-[#2F6BFF] text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {cols === 2 && <Grid2Icon />}
                {cols === 3 && <Grid3Icon />}
                {cols === 4 && <Grid4Icon />}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
        }}
      >
        {displayPhotos.map((photo, index) => {
          const rankLabel = tab === 'popular' ? getRankLabel(index) : null
          const gridImage =
            photo.thumbnail_url || photo.preview_url || photo.public_url

          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className="group relative block overflow-hidden rounded-[4px] bg-slate-100 text-left"
            >
              <img
                src={gridImage}
                loading="lazy"
                decoding="async"
                alt={photo.filename || 'photo'}
                className="aspect-[3/4] w-full object-cover transition duration-300 group-hover:scale-105"
              />

              {rankLabel ? (
                <div
                  className={`absolute left-3 top-3 z-10 rounded-lg px-2.5 py-1 text-[11px] font-black shadow-md backdrop-blur ${getRankClass(
                    index
                  )}`}
                >
                  {rankLabel}
                </div>
              ) : null}

              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/45 to-transparent px-2 py-2">
                <p className="truncate text-[10px] text-white/90">
                  {photo.filename || 'photo'}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {hasMore ? (
        <div className="flex justify-center py-8">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-95 disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load More'}
          </button>
        </div>
      ) : null}

      {activeIndex !== null && activePhoto ? (
        <div className="fixed inset-0 z-50 bg-black text-white">
          <div
            ref={viewerRef}
            className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth"
            onScroll={() => {
              if (!viewerRef.current) return

              const width = viewerRef.current.clientWidth
              const nextIndex = Math.round(viewerRef.current.scrollLeft / width)

              if (
                nextIndex !== activeIndex &&
                nextIndex >= 0 &&
                nextIndex < displayPhotos.length
              ) {
                setActiveIndex(nextIndex)
                setScale(1)
              }
            }}
          >
            {displayPhotos.map((photo, index) => (
              <div
                key={photo.id}
                className="flex h-full w-full shrink-0 snap-center items-center justify-center px-3"
              >
                <img
                  src={photo.preview_url || photo.public_url}
                  alt={photo.filename || 'photo'}
                  loading={index === activeIndex ? 'eager' : 'lazy'}
                  decoding="async"
                  onClick={handleDoubleTap}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  className="max-h-full max-w-full select-none object-contain transition-transform duration-200"
                  style={{
                    transform: `scale(${index === activeIndex ? scale : 1})`,
                    touchAction: scale > 1 ? 'none' : 'pan-y pinch-zoom',
                  }}
                />
              </div>
            ))}
          </div>

          <div className="pointer-events-none absolute left-0 right-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setActiveIndex(null)}
                className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl backdrop-blur"
              >
                ✕
              </button>

              <div className="rounded-full bg-white/15 px-3 py-1.5 text-xs backdrop-blur">
                {activeIndex + 1} / {displayPhotos.length}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={goPrev}
            disabled={activeIndex === 0}
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl backdrop-blur disabled:opacity-20"
          >
            ‹
          </button>

          <button
            type="button"
            onClick={goNext}
            disabled={activeIndex === displayPhotos.length - 1}
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl backdrop-blur disabled:opacity-20"
          >
            ›
          </button>

          <div className="absolute bottom-6 left-4 right-4 flex items-center justify-between gap-3">
            <div className="min-w-0 rounded-full bg-white/15 px-4 py-3 text-xs backdrop-blur">
              <p className="truncate">{activePhoto.filename || 'photo'}</p>
            </div>

            <a
              href={activePhoto.public_url}
              download
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#2F6BFF] shadow"
            >
              Download
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
}