'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NextImage from 'next/image'
import { getGuestId } from '@/lib/guest-id'
import { useI18n } from '@/components/i18n-provider'
import {
  Grid2Icon,
  Grid3Icon,
  Grid4Icon,
} from '@/components/gallery-grid-icons'
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
  like_count?: number | null
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
  if (rank === 1) return 'bg-gold text-ink'
  if (rank === 2) return 'bg-white/85 text-ink'
  if (rank === 3) return 'bg-gold-deep text-white'
  return 'bg-ink/70 text-white'
}

function getSafeGridCols(value: number) {
  if (value === 2 || value === 3 || value === 4) return value
  return 3
}

/*
 * The 2/3/4 control sets density, not an absolute column count: holding a
 * literal 3 columns everywhere gave 114px tiles on a phone and 320px tiles
 * on a desktop off the same setting. Widening the grid adds columns so a
 * tile stays in roughly the same size band on every device.
 */
function getResponsiveGridCols(baseCols: number, containerWidth: number) {
  if (containerWidth >= 880) return baseCols + 2
  if (containerWidth >= 620) return baseCols + 1
  return baseCols
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
  liked,
  likeCount,
  onToggleLike,
}: {
  photo: Photo
  index: number
  tab: 'live' | 'popular'
  onOpen: (index: number) => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
  liked: boolean
  likeCount: number
  onToggleLike: (id: string) => void
}) {
  const { t } = useI18n()
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
      className="group relative block h-full w-full overflow-hidden rounded-[3px] bg-ground-sunken text-left"
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
          <div className="absolute inset-0 z-0 bg-ground-sunken" />
        )}
      </div>

      {selectMode ? (
        <div
          className={`absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-full border-2 backdrop-blur transition-colors ${
            selected
              ? 'border-gold bg-gold text-white'
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
          className={`absolute left-3 top-3 z-20 rounded-lg px-2.5 py-1 text-[11px] font-semibold shadow-md backdrop-blur ${getRankClass(
            index
          )}`}
        >
          {rankLabel}
        </div>
      ) : null}

      {/* Heart reaction. A nested control inside the tile button, so its own
          click is stopped from opening the lightbox. Hidden in select mode,
          where the checkbox owns the top-right corner. */}
      {!selectMode ? (
        <span
          role="button"
          tabIndex={0}
          aria-pressed={liked}
          aria-label={liked ? t.gallery.removeLike : t.gallery.likePhoto}
          onClick={(event) => {
            event.stopPropagation()
            onToggleLike(photo.id)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onToggleLike(photo.id)
            }
          }}
          className="absolute right-2 top-2 z-30 flex h-8 items-center gap-1 rounded-full bg-black/35 px-2 text-white backdrop-blur-md transition active:scale-90"
        >
          <svg
            viewBox="0 0 24 24"
            fill={liked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`h-4 w-4 transition-colors ${liked ? 'text-rose' : 'text-white'}`}
          >
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
          </svg>
          {likeCount > 0 ? (
            <span className="text-[11px] font-semibold tabular-nums">
              {likeCount}
            </span>
          ) : null}
        </span>
      ) : null}

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
  likedIds: Set<string>
  likeCounts: Record<string, number>
  onToggleLike: (id: string) => void
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
        liked={data.likedIds.has(photo.id)}
        likeCount={
          data.likeCounts[photo.id] ?? Number(photo.like_count || 0)
        }
        onToggleLike={data.onToggleLike}
      />
    </div>
  )
})

export default function PublicGallery({
  photos: initialPhotos,
  shareToken,
}: Props) {
  const { t } = useI18n()
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

  /*
   * Measured here rather than with AutoSizer: AutoSizer stopped re-reporting
   * after its first measurement, so rotating a phone left the virtual grid
   * at the old width — 796px of container still rendering a 343px grid, with
   * the remainder blank. A ResizeObserver on the container we own reflows on
   * every size change, including orientation.
   */
  const gridContainerRef = useRef<HTMLDivElement | null>(null)
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const node = gridContainerRef.current
    if (!node) return

    function measure(element: HTMLDivElement) {
      const { width, height } = element.getBoundingClientRect()

      setGridSize((current) =>
        Math.round(current.width) === Math.round(width) &&
        Math.round(current.height) === Math.round(height)
          ? current
          : { width, height }
      )
    }

    measure(node)

    const observer = new ResizeObserver(() => measure(node))
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

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

  // ── Photo likes ────────────────────────────────────────────────────────
  // Which photos this visitor has hearted lives in localStorage (keyed to the
  // share token), the same lightweight model Guest Moments uses; the server
  // holds the authoritative counts.
  const likeStorageKey = shareToken ? `ciiya-liked-photos-${shareToken}` : ''
  // Seeded lazily (client-only). The hearts/counts these drive render on the
  // client-side grid, so there's no server HTML to mismatch — and reading here
  // rather than in an effect keeps the setState out of a cascading effect.
  const [likedIds, setLikedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined' || !likeStorageKey) return new Set()
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(likeStorageKey) || '[]'
      )
      return new Set<string>(Array.isArray(saved) ? saved.map(String) : [])
    } catch {
      return new Set()
    }
  })
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const photo of initialPhotos) init[photo.id] = Number(photo.like_count || 0)
    return init
  })

  const toggleLike = useCallback(
    (photoId: string) => {
      if (!shareToken) return

      const wasLiked = likedIds.has(photoId)
      const delta = wasLiked ? -1 : 1

      // Optimistic: flip the heart, nudge the count, and tell the tab badge.
      setLikedIds((current) => {
        const next = new Set(current)
        if (wasLiked) next.delete(photoId)
        else next.add(photoId)
        if (likeStorageKey) {
          window.localStorage.setItem(
            likeStorageKey,
            JSON.stringify(Array.from(next))
          )
        }
        return next
      })
      setLikeCounts((current) => ({
        ...current,
        [photoId]: Math.max(0, Number(current[photoId] || 0) + delta),
      }))
      window.dispatchEvent(
        new CustomEvent('ciiya-photo-like', { detail: { delta } })
      )

      fetch('/api/share/photo-likes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: shareToken, photoId, guestId: getGuestId() }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (!data?.success) throw new Error(data?.error || 'like failed')
          // Reconcile with the authoritative count from the server.
          setLikeCounts((current) => ({
            ...current,
            [photoId]: Number(data.likeCount || 0),
          }))
        })
        .catch(() => {
          // Roll back the optimistic changes.
          setLikedIds((current) => {
            const next = new Set(current)
            if (wasLiked) next.add(photoId)
            else next.delete(photoId)
            if (likeStorageKey) {
              window.localStorage.setItem(
                likeStorageKey,
                JSON.stringify(Array.from(next))
              )
            }
            return next
          })
          setLikeCounts((current) => ({
            ...current,
            [photoId]: Math.max(0, Number(current[photoId] || 0) - delta),
          }))
          window.dispatchEvent(
            new CustomEvent('ciiya-photo-like', { detail: { delta: -delta } })
          )
        })
    },
    [shareToken, likedIds, likeStorageKey]
  )

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
      likedIds,
      likeCounts,
      onToggleLike: toggleLike,
    }),
    [displayPhotos, gridCols, tab, openPhoto, selectMode, selectedIds, toggleSelect, likedIds, likeCounts, toggleLike]
  )

  return (
    <div className="space-y-4">
      {/*
        Labels get whitespace-nowrap because at 375px the flex row squeezed
        them until "Live Photos" broke onto two lines and the flame emoji in
        "Popular" dropped to a line of its own, which read as a broken bar.
      */}
      {/*
        On a landscape phone the whole toolbar lands in the bottom-right
        corner, right under the fixed face-search button. Reserving a lane
        on short viewports keeps the density controls tappable there.
      */}
      {/*
        The old floor of 520px was taller than a landscape phone's whole
        viewport (390px), so the grid alone overflowed the screen. Floor is
        now low enough to fit one, and the ceiling keeps a tall desktop
        window from turning the grid into an endless column.
      */}
      <section className="overflow-hidden rounded-hero border border-line bg-surface shadow-card">
        <div className="relative px-4 py-5 sm:px-6 sm:py-6">
          <div aria-hidden className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-gold/20 blur-3xl" />

          {/* Toolbar sits inside the card, above the grid: the Latest/Popular
              tabs on the left and the density (column) controls on the right. */}
          <div className="relative mb-4 [@media(max-height:480px)]:pr-[76px] sm:mb-5">
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              <div className="inline-flex shrink-0 items-center rounded-full border border-line bg-ground-sunken p-1">
                <button
                  type="button"
                  onClick={() => setTab('live')}
                  aria-pressed={tab === 'live'}
                  className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition sm:px-4 sm:py-2 sm:text-[13px] ${
                    tab === 'live' ? 'bg-surface text-ink shadow-[0_1px_5px_rgba(15,23,42,0.1)]' : 'text-muted hover:text-ink'
                  }`}
                >
                  {t.gallery.latestPhotos}
                </button>

                <button
                  type="button"
                  onClick={() => setTab('popular')}
                  aria-pressed={tab === 'popular'}
                  className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition sm:px-4 sm:py-2 sm:text-[13px] ${
                    tab === 'popular' ? 'bg-surface text-ink shadow-[0_1px_5px_rgba(15,23,42,0.1)]' : 'text-muted hover:text-ink'
                  }`}
                >
                  {t.gallery.popularPhotos}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="grid shrink-0 grid-cols-3 gap-1 overflow-hidden rounded-[22px] border border-black/5 p-1 sm:gap-1.5 sm:rounded-[26px] sm:p-1.5">
                  {[2, 3, 4].map((cols) => (
                     <button
                      key={cols}
                      type="button"
                      onClick={() => setGridCols(cols)}
                      aria-label={`Density ${cols}`}
                      aria-pressed={gridCols === cols}
                      className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 active:scale-90 sm:h-9 sm:w-9 ${
                        gridCols === cols
                          ? 'bg-gold-soft text-gold-deep'
                          : 'text-muted'
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

          <div
            ref={gridContainerRef}
            className="relative h-[72vh] max-h-[900px] min-h-[320px] overflow-hidden rounded-[4px]"
          >
        {gridSize.width > 0 && gridSize.height > 0
          ? (() => {
              const safeWidth = Math.max(1, gridSize.width)
              const responsiveCols = getResponsiveGridCols(gridCols, safeWidth)
              const columnWidth = Math.floor(safeWidth / responsiveCols)
              const rowHeight = Math.round((columnWidth * 4) / 3)
              const rowCount = Math.ceil(
                displayPhotos.length / responsiveCols
              )

              return (
                <VirtualGrid
                  height={gridSize.height}
                  width={safeWidth}
                  columnCount={responsiveCols}
                  columnWidth={columnWidth}
                  rowCount={rowCount}
                  rowHeight={rowHeight}
                  overscanRowCount={3}
                  itemData={{ ...gridData, gridCols: responsiveCols }}
                  itemKey={({ columnIndex, rowIndex, data }) => {
                    const photoIndex =
                      rowIndex * data.gridCols + columnIndex
                    return (
                      data.photos[photoIndex]?.id ||
                      `${rowIndex}-${columnIndex}`
                    )
                  }}
                >
                  {VirtualPhotoCell}
                </VirtualGrid>
              )
            })()
          : null}
          </div>
        </div>
      </section>

      {!selectMode ? (
        <div className="fixed inset-x-0 bottom-5 z-[90] flex justify-center px-4">
          <button
            type="button"
            onClick={toggleSelectMode}
            className="flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[13px] font-semibold text-white shadow-float transition-transform active:scale-95"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <rect x="3" y="3" width="8" height="8" rx="2" />
              <rect x="13" y="3" width="8" height="8" rx="2" />
              <rect x="3" y="13" width="8" height="8" rx="2" />
              <path d="m14.5 17 2 2 4-4" />
            </svg>
            {t.gallery.selectPhotos}
          </button>
        </div>
      ) : null}

      {selectMode ? (
        <div className="fixed inset-x-0 bottom-5 z-[90] flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full bg-ink px-3 py-2 text-white shadow-float">
            <button
              type="button"
              onClick={toggleSelectMode}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-lg"
              aria-label={t.gallery.deselect}
            >
              ✕
            </button>

            <p className="whitespace-nowrap px-1 text-sm font-semibold">
              {t.gallery.selectedCount(selectedIds.size, MAX_SELECTION)}
            </p>

            <button
              type="button"
              onClick={handleBatchDownload}
              disabled={selectedIds.size === 0 || batchDownloading}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gold px-4 py-2 text-[13px] font-semibold text-ink transition-opacity disabled:opacity-40"
            >
              {batchDownloading ? t.gallery.downloading : t.gallery.download}
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
                alt={activePhoto.filename || t.gallery.photoAlt}
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
                {t.gallery.notReady}
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
                className="pointer-events-auto flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[13px] font-semibold text-ink shadow-lg transition-transform active:scale-95"
              >
                {t.gallery.downloadPhotos}
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
