'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Grid2Icon,
  Grid3Icon,
  Grid4Icon,
} from '@/components/gallery-grid-icons'
import AutoSizer from 'react-virtualized-auto-sizer'
import {
  FixedSizeGrid as VirtualGrid,
  type GridChildComponentProps,
} from 'react-window'

type Photo = {
  id: string
  public_url: string
  preview_url?: string | null
  thumbnail_url?: string | null
  blur_data_url?: string | null
  filename?: string | null
  view_count?: number | null
}

type Props = {
  photos: Photo[]
  totalCount?: number
  albumTitle?: string
  albumId?: string
  shareToken?: string
}

type TouchPoint = {
  x: number
  y: number
}

function getDisplayImageUrl(photo: Photo) {
  return photo.preview_url || photo.thumbnail_url || ''
}

function getThumbnailImageUrl(photo: Photo) {
  return photo.thumbnail_url || photo.preview_url || ''
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

function preloadImage(src?: string | null) {
  if (!src) return
  const img = new Image()
  img.src = src
}

function getInitialGridCols() {
  if (typeof window === 'undefined') return 3

  return getSafeGridCols(
    Number(window.localStorage.getItem('public-gallery-cols') || 3)
  )
}

const PhotoTile = memo(function PhotoTile({
  photo,
  index,
  tab,
  onOpen,
}: {
  photo: Photo
  index: number
  tab: 'live' | 'popular'
  onOpen: (index: number) => void
}) {
  const rankLabel = tab === 'popular' ? getRankLabel(index) : null

  const imageSources = useMemo(() => {
    return [getThumbnailImageUrl(photo), getDisplayImageUrl(photo)].filter(
      (src, sourceIndex, arr): src is string =>
        Boolean(src) && arr.indexOf(src) === sourceIndex
    )
  }, [photo])

  const imageKey = `${photo.id}:${imageSources.join('|')}`

  const [imageState, setImageState] = useState({
    key: imageKey,
    loaded: false,
    srcIndex: 0,
  })

  const loaded = imageState.key === imageKey ? imageState.loaded : false
  const srcIndex = imageState.key === imageKey ? imageState.srcIndex : 0

  const gridImage = imageSources[srcIndex] || ''
  const previewImage = getDisplayImageUrl(photo)

  function handleImageError() {
    if (srcIndex < imageSources.length - 1) {
      setImageState({
        key: imageKey,
        loaded: false,
        srcIndex: srcIndex + 1,
      })
      return
    }

    setImageState({
      key: imageKey,
      loaded: true,
      srcIndex,
    })
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      onMouseEnter={() => preloadImage(previewImage)}
      onTouchStart={() => preloadImage(previewImage)}
      className="group relative block h-full w-full overflow-hidden rounded-[4px] bg-slate-100 text-left"
    >
      <div className="relative h-full w-full overflow-hidden">
        {!loaded && photo.blur_data_url ? (
          <img
            src={photo.blur_data_url}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 z-0 h-full w-full scale-110 object-cover blur-2xl"
          />
        ) : null}

        {gridImage ? (
          <img
            key={`${photo.id}:${gridImage}`}
            src={gridImage}
            loading={index < 12 ? 'eager' : 'lazy'}
            decoding="async"
            alt={photo.filename || 'photo'}
            onLoad={() =>
              setImageState({
                key: imageKey,
                loaded: true,
                srcIndex,
              })
            }
            onError={handleImageError}
            className="relative z-10 h-full w-full object-cover transition-transform duration-300 will-change-transform group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 z-0 bg-slate-200" />
        )}
      </div>

      {rankLabel ? (
        <div
          className={`absolute left-3 top-3 z-20 rounded-lg px-2.5 py-1 text-[11px] font-black shadow-md backdrop-blur ${getRankClass(
            index
          )}`}
        >
          {rankLabel}
        </div>
      ) : null}

      <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/45 to-transparent px-2 py-2">
        <p className="truncate text-[10px] text-white/90">
          {photo.filename || 'photo'}
        </p>
      </div>
    </button>
  )
})

type VirtualPhotoCellData = {
  photos: Photo[]
  gridCols: number
  tab: 'live' | 'popular'
  onOpen: (index: number) => void
}

const VirtualPhotoCell = memo(function VirtualPhotoCell({
  columnIndex,
  rowIndex,
  style,
  data,
}: GridChildComponentProps<VirtualPhotoCellData>) {
  const index = rowIndex * data.gridCols + columnIndex
  const photo = data.photos[index]

  if (!photo) return null

  return (
    <div style={{ ...style, padding: 2 }}>
      <PhotoTile
        key={photo.id}
        photo={photo}
        index={index}
        tab={data.tab}
        onOpen={data.onOpen}
      />
    </div>
  )
})

export default function PublicGallery({ photos: initialPhotos }: Props) {
  const photos = initialPhotos
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [tab, setTab] = useState<'live' | 'popular'>('live')
  const [scale, setScale] = useState(1)
  const [lastTap, setLastTap] = useState(0)
  const [gridCols, setGridCols] = useState(getInitialGridCols)
  const [viewerLoaded, setViewerLoaded] = useState(false)

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

  const displayPhotos = useMemo(
    () => (tab === 'live' ? photos : popularPhotos),
    [photos, popularPhotos, tab]
  )

  const activePhoto = activeIndex !== null ? displayPhotos[activeIndex] : null
  const activeImageUrl = activePhoto ? getDisplayImageUrl(activePhoto) : ''

  useEffect(() => {
    if (typeof window === 'undefined') return

    window.localStorage.setItem('public-gallery-cols', String(gridCols))
  }, [gridCols])

  useEffect(() => {
    if (activeIndex === null) return

    const preloadIndexes = [activeIndex - 1, activeIndex + 1]

    preloadIndexes.forEach((photoIndex) => {
      const photo = displayPhotos[photoIndex]
      if (!photo) return
      preloadImage(getDisplayImageUrl(photo))
    })
  }, [activeIndex, displayPhotos])

  useEffect(() => {
    if (activeIndex === null) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setActiveIndex(null)

      if (e.key === 'ArrowRight') {
        setScale(1)
        setViewerLoaded(false)

        setActiveIndex((current) => {
          if (current === null) return current
          return Math.min(current + 1, displayPhotos.length - 1)
        })
      }

      if (e.key === 'ArrowLeft') {
        setScale(1)
        setViewerLoaded(false)

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

  const openPhoto = useCallback((index: number) => {
    setScale(1)
    setViewerLoaded(false)
    setActiveIndex(index)
  }, [])

  function goPrev() {
    setScale(1)
    setViewerLoaded(false)

    setActiveIndex((current) => {
      if (current === null) return current
      return Math.max(current - 1, 0)
    })
  }

  function goNext() {
    setScale(1)
    setViewerLoaded(false)

    setActiveIndex((current) => {
      if (current === null) return current
      return Math.min(current + 1, displayPhotos.length - 1)
    })
  }

  function handleDoubleTap() {
    const now = Date.now()

    if (now - lastTap < 280) {
      setScale((current) => (current > 1 ? 1 : 2.25))
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

  const gridData = useMemo(
    () => ({
      photos: displayPhotos,
      gridCols,
      tab,
      onOpen: openPhoto,
    }),
    [displayPhotos, gridCols, tab, openPhoto]
  )

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

         <div className="grid grid-cols-3 gap-1.5 border border-black/5 overflow-hidden rounded-[26px]">
            {[2, 3, 4].map((cols) => (
              <button
                key={cols}
                type="button"
                onClick={() => setGridCols(cols)}
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 active:scale-90',
                 gridCols === cols
                    ? 'bg-[#F0B1DE] text-white'
                    : 'text-slate-500',
               ].join(' ')}
              >
                {cols === 2 && <Grid2Icon />}
                {cols === 3 && <Grid3Icon />}
                {cols === 4 && <Grid4Icon />}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-[72vh] min-h-[520px] overflow-hidden rounded-[4px]">
        <AutoSizer>
          {({ height, width }) => {
            const safeWidth = Math.max(1, width)
            const columnWidth = Math.floor(safeWidth / gridCols)
            const rowHeight = Math.round((columnWidth * 4) / 3)
            const rowCount = Math.ceil(displayPhotos.length / gridCols)

            return (
              <VirtualGrid
                height={height}
                width={safeWidth}
                columnCount={gridCols}
                columnWidth={columnWidth}
                rowCount={rowCount}
                rowHeight={rowHeight}
                overscanRowCount={3}
                itemData={gridData}
                itemKey={({ columnIndex, rowIndex, data }) => {
                  const photoIndex = rowIndex * data.gridCols + columnIndex
                  return (
                    data.photos[photoIndex]?.id ||
                    `${rowIndex}-${columnIndex}`
                  )
                }}
              >
                {VirtualPhotoCell}
              </VirtualGrid>
            )
          }}
        </AutoSizer>
      </div>

      {activeIndex !== null && activePhoto ? (
        <div className="fixed inset-0 z-[100] bg-black text-white">
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center px-3">
            {!viewerLoaded ? (
              <div className="absolute h-24 w-24 animate-pulse rounded-3xl bg-white/10" />
            ) : null}

            {activeImageUrl ? (
              <img
                key={activePhoto.id}
                src={activeImageUrl}
                alt={activePhoto.filename || 'photo'}
                loading="eager"
                decoding="async"
                onLoad={() => setViewerLoaded(true)}
                onError={() => setViewerLoaded(true)}
                onClick={handleDoubleTap}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className={`pointer-events-auto max-h-full max-w-full select-none object-contain transition-all duration-300 will-change-transform ${
                  viewerLoaded ? 'opacity-100 blur-0' : 'opacity-0 blur-sm'
                }`}
                style={{
                  transform: `scale(${scale})`,
                  touchAction: scale > 1 ? 'none' : 'pan-y pinch-zoom',
                }}
              />
            ) : (
              <div className="rounded-3xl bg-white/10 px-5 py-4 text-sm text-white/70">
                Image is not ready
              </div>
            )}
          </div>

          <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent p-4">
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
            className="absolute left-3 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl backdrop-blur disabled:opacity-20"
          >
            ‹
          </button>

          <button
            type="button"
            onClick={goNext}
            disabled={activeIndex === displayPhotos.length - 1}
            className="absolute right-3 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl backdrop-blur disabled:opacity-20"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  )
}