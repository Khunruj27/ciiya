'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PublicGallery from '@/components/public-gallery'
import PublicGalleryRealtime from '@/components/public-gallery-realtime'

type Photo = {
  id: string
  album_id: string
  filename: string | null

  public_url: string
  original_url?: string | null
  preview_url: string | null
  thumbnail_url: string | null
  sd_url?: string | null
  hd_url?: string | null
  uhd_url?: string | null

  storage_path?: string | null
  original_path?: string | null
  preview_path?: string | null
  thumbnail_path?: string | null
  sd_path?: string | null
  hd_path?: string | null
  uhd_path?: string | null
  selected_size?: string | null

  created_at: string
  view_count?: number | null
  processing_status?: string | null
  blur_data_url?: string | null
}

type Props = {
  initialPhotos: Photo[]
  totalCount: number
  albumTitle: string
  albumId: string
  shareToken?: string
  initialCursor: string | null
}

function isReadyPhoto(photo: Photo) {
  return (
    photo.processing_status === 'done' &&
    Boolean(photo.public_url) &&
    Boolean(photo.preview_url) &&
    Boolean(photo.thumbnail_url)
  )
}
  
function getTokenFromUrl() {
  if (typeof window === 'undefined') return ''
  return window.location.pathname.split('/share/')[1]?.split('/')[0] || ''
}

export default function PublicGalleryInfinite({
  initialPhotos,
  totalCount,
  albumTitle,
  albumId,
  shareToken,
  initialCursor,
}: Props) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos)
  const [cursor, setCursor] = useState(initialCursor)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(Boolean(initialCursor))

  const loaderRef = useRef<HTMLDivElement | null>(null)
  const isFetchingRef = useRef(false)
  const loadingRef = useRef(false)
  const mountedRef = useRef(false)
  

  useEffect(() => {
  loadingRef.current = loading
}, [loading])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const prependRealtimePhotos = useCallback((nextPhotos: Photo[]) => {
    const readyPhotos = nextPhotos.filter(isReadyPhoto)
    if (!readyPhotos.length) return

    setPhotos((prev) => {
      const existing = new Set(prev.map((photo) => photo.id))
      const uniqueNew = readyPhotos.filter((photo) => !existing.has(photo.id))
      return uniqueNew.length ? [...uniqueNew, ...prev] : prev
    })
  }, [])

  const appendOlderPhotos = useCallback((nextPhotos: Photo[]) => {
    const readyPhotos = nextPhotos.filter(isReadyPhoto)
    if (!readyPhotos.length) return

    setPhotos((prev) => {
      const existing = new Set(prev.map((photo) => photo.id))
      const uniqueOld = readyPhotos.filter((photo) => !existing.has(photo.id))
      return uniqueOld.length ? [...prev, ...uniqueOld] : prev
    })
  }, [])

  const loadMore = useCallback(async () => {
    const resolvedShareToken = shareToken || getTokenFromUrl()

    if (
      isFetchingRef.current ||
      loadingRef.current ||
      !hasMore ||
      !cursor ||
      !resolvedShareToken
    ) {
      return
    }

    try {
      isFetchingRef.current = true
      setLoading(true)

      const params = new URLSearchParams({
        token: resolvedShareToken,
        cursor,
        limit: '50',
      })

      const res = await fetch(`/api/share/photos?${params.toString()}`, {
        cache: 'no-store',
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Load more failed')
      }

      if (!mountedRef.current) return

      appendOlderPhotos(data.photos || [])

      setCursor(data.nextCursor || null)
      setHasMore(Boolean(data.hasMore))
    } catch (error) {
      console.error('[PublicGalleryInfinite]', error)

      if (mountedRef.current) {
        setHasMore(false)
      }
    } finally {
      isFetchingRef.current = false

      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [appendOlderPhotos, cursor, hasMore, shareToken])

  useEffect(() => {
    const target = loaderRef.current
    if (!target) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          loadMore()
        }
      },
      {
        rootMargin: '1200px',
        threshold: 0,
      }
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [loadMore])

  const visiblePhotos = useMemo(() => {
    return photos.filter(isReadyPhoto)
  }, [photos])

  return (
    <>
      <PublicGalleryRealtime
        albumId={albumId}
        onPhotosDone={prependRealtimePhotos}
      />

      <PublicGallery
        photos={visiblePhotos}
        totalCount={totalCount}
        albumTitle={albumTitle}
        albumId={albumId}
        shareToken={shareToken || getTokenFromUrl()}
      />

      {hasMore ? (
        <div className="flex flex-col items-center gap-4 py-10">
          <div ref={loaderRef} className="h-10 w-full" />

          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-full border border-line bg-surface px-5 py-3 text-[13px] font-semibold text-ink shadow-card transition hover:bg-ground disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more photos'}
          </button>
        </div>
      ) : null}
    </>
  )
}
