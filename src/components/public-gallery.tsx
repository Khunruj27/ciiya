'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NextImage from 'next/image'
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

  original_url?: string | null
  preview_url?: string | null
  thumbnail_url?: string | null
  sd_url?: string | null
  hd_url?: string | null
  uhd_url?: string | null

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

const MAX_SELECTION = 10

type TouchPoint = {
  x: number
  y: number
}

function getDisplayImageUrl(photo: Photo) {
  return (
    photo.preview_url ||
    photo.hd_url ||
    photo.uhd_url ||
    photo.original_url ||
    photo.public_url ||
    photo.thumbnail_url ||
    ''
  )
}

function getThumbnailImageUrl(photo: Photo) {
  return (
    photo.thumbnail_url ||
    photo.preview_url ||
    photo.hd_url ||
    photo.public_url ||
    ''
  )
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


const PhotoTile = memo(function PhotoTile({
  photo,
  index,
  tab,
  onOpen,
  selectMode,
  selected,
  onToggleSelect,
}: {
  photo: Photo
  index: number
  tab: 'live' | 'popular'
  onOpen: (index: number) => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
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
  const isOriginalFallback =
    Boolean(gridImage) && gridImage === photo.public_url

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
      onClick={() =>
        selectMode ? onToggleSelect(photo.id) : onOpen(index)
      }
      onMouseEnter={() => preloadImage(previewImage)}
      onTouchStart={() => preloadImage(previewImage)}
      className="group relative block h-full w-full overflow-hidden rounded-[4px] bg-slate-100 text-left"
    >
      <div className="relative h-full w-full overflow-hidden">
        {!loaded && photo.blur_data_url ? (
          <NextImage
            src={photo.blur_data_url}
            alt=""
            aria-hidden="true"
            fill
            unoptimized
            className="z-0 scale-110 object-cover blur-2xl"
          />
        ) : null}

        {gridImage ? (
          <NextImage
            key={`${photo.id}:${gridImage}`}
            src={gridImage}
            fill
            sizes="(max-width: 768px) 33vw, 25vw"
            unoptimized={isOriginalFallback}
            loading={index < 12 ? 'eager' : 'lazy'}
            alt={photo.filename || 'photo'}
            onLoad={() =>
              setImageState({
                key: imageKey,
                loaded: true,
                srcIndex,
              })
            }
            onError={handleImageError}
            className="z-10 object-cover transition-transform duration-300 will-change-transform group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 z-0 bg-slate-200" />
        )}
      </div>

      {selectMode ? (
        <div
          className={`absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-full border-2 backdrop-blur transition-colors ${
            selected
              ? 'border-[#F0B1DE] bg-[#F0B1DE] text-white'
              : 'border-white/80 bg-black/20 text-transparent'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
      ) : null}

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
  selectMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
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
        selectMode={data.selectMode}
        selected={data.selectedIds.has(photo.id)}
        onToggleSelect={data.onToggleSelect}
      />
    </div>
  )
})

export default function PublicGallery({
  photos: initialPhotos,
  shareToken,
}: Props) {
  const photos = initialPhotos
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [tab, setTab] = useState<'live' | 'popular'>('live')
  const [scale, setScale] = useState(1)
  const [lastTap, setLastTap] = useState(0)
  const [gridCols, setGridCols] = useState(3)
  const [viewerLoaded, setViewerLoaded] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDownloading, setBatchDownloading] = useState(false)

  const pinchStartDistance = useRef<number | null>(null)
  const startScale = useRef(1)
  const preloadedImagesRef = useRef<Set<string>>(new Set())

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
  const frameId = window.requestAnimationFrame(() => {
    const savedGridCols = getSafeGridCols(
      Number(
        window.localStorage.getItem(
          'public-gallery-cols'
        ) || 3
      )
    )

    setGridCols((current) =>
      current === savedGridCols
        ? current
        : savedGridCols
    )
  })

  return () => {
    window.cancelAnimationFrame(frameId)
  }
}, [])

  useEffect(() => {
  window.localStorage.setItem(
    'public-gallery-cols',
    String(gridCols)
  )
}, [gridCols])

useEffect(() => {
  if (activeIndex === null) return

  const preloadIndexes = [activeIndex - 1, activeIndex + 1]

  preloadIndexes.forEach((photoIndex) => {
    const photo = displayPhotos[photoIndex]
    if (!photo) return

    const src = getDisplayImageUrl(photo)
    if (!src || preloadedImagesRef.current.has(src)) return

    preloadedImagesRef.current.add(src)
    preloadImage(src)
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

  const toggleSelectMode = useCallback(() => {
    setSelectMode((current) => !current)
    setSelectedIds(new Set())
  }, [])

  const toggleSelect = useCallback((photoId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)

      if (next.has(photoId)) {
        next.delete(photoId)
        return next
      }

      if (next.size >= MAX_SELECTION) return next

      next.add(photoId)
      return next
    })
  }, [])

  // Triggers one native download per selected photo (each request already
  // returns a plain .jpg with a Content-Disposition: attachment header via
  // /api/photos/download), staggered so the browser fires them as distinct
  // downloads instead of one another.
  const handleBatchDownload = useCallback(() => {
    if (!shareToken || selectedIds.size === 0 || batchDownloading) return

    setBatchDownloading(true)

    const ids = Array.from(selectedIds)

    ids.forEach((photoId, index) => {
      window.setTimeout(() => {
        const link = document.createElement('a')
        link.href = `/api/photos/download?photoId=${encodeURIComponent(
          photoId
        )}&token=${encodeURIComponent(shareToken)}`
        document.body.appendChild(link)
        link.click()
        link.remove()
      }, index * 400)
    })

    window.setTimeout(() => {
      setBatchDownloading(false)
      setSelectMode(false)
      setSelectedIds(new Set())
    }, ids.length * 400)
  }, [shareToken, selectedIds, batchDownloading])

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
      selectMode,
      selectedIds,
      onToggleSelect: toggleSelect,
    }),
    [displayPhotos, gridCols, tab, openPhoto, selectMode, selectedIds, toggleSelect]
  )

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-6">
            <button type="button" onClick={() => setTab('live')}>
              <p
                className={`text-sm font-semibold ${
                  tab === 'live' ? 'text-[#F0B1DE]' : 'text-slate-600'
                }`}
              >
                Live Photos
              </p>
              {tab === 'live' ? (
                <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-[#F0B1DE]" />
              ) : null}
            </button>

            <button type="button" onClick={() => setTab('popular')}>
              <p
                className={`text-sm font-semibold ${
                  tab === 'popular' ? 'text-[#F0B1DE]' : 'text-slate-600'
                }`}
              >
                Popular🔥
              </p>
              {tab === 'popular' ? (
                <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-[#F0B1DE]" />
              ) : null}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="grid grid-cols-3 gap-1.5 border border-black/5 overflow-hidden rounded-[26px] p-1.5">
              {[2, 3, 4].map((cols) => (
                 <button
                  key={cols}
                  type="button"
                  onClick={() => setGridCols(cols)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 active:scale-90 ${
                    gridCols === cols
                      ? 'bg-[#F0B1DE] text-white shadow-sm'
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

      {!selectMode ? (
        <div className="fixed inset-x-0 bottom-5 z-[90] flex justify-center px-4">
          <button
            type="button"
            onClick={toggleSelectMode}
            className="flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-[0_18px_50px_rgba(15,23,42,0.35)] transition-transform active:scale-95"
          >
            🖼️ Select photos
          </button>
        </div>
      ) : null}

      {selectMode ? (
        <div className="fixed inset-x-0 bottom-5 z-[90] flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full bg-slate-900 px-3 py-2 text-white shadow-[0_18px_50px_rgba(15,23,42,0.35)]">
            <button
              type="button"
              onClick={toggleSelectMode}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-lg"
              aria-label="Cancel selection"
            >
              ✕
            </button>

            <p className="whitespace-nowrap px-1 text-sm font-semibold">
              {selectedIds.size}/{MAX_SELECTION} selected
            </p>

            <button
              type="button"
              onClick={handleBatchDownload}
              disabled={selectedIds.size === 0 || batchDownloading}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#F0B1DE] px-4 py-2 text-sm font-bold text-[#4A3140] transition-opacity disabled:opacity-40"
            >
              {batchDownloading ? 'Downloading…' : '⬇ Download'}
            </button>
          </div>
        </div>
      ) : null}

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

          {shareToken ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-5 pb-7">
              <a
                href={`/api/photos/download?photoId=${encodeURIComponent(
                  activePhoto.id
                )}&token=${encodeURIComponent(shareToken)}`}
                className="pointer-events-auto flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-900 shadow-lg transition-transform active:scale-95"
              >
                ⬇ Download photo
              </a>

              {activePhoto.filename ? (
                <p className="max-w-[80%] truncate text-center text-[11px] font-medium text-white/70">
                  {activePhoto.filename}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}