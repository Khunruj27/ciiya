'use client'

import { useEffect, useRef, useState } from 'react'
import PublicGallery from '@/components/public-gallery'


type Photo = {
  id: string
  album_id: string
  filename: string | null
  public_url: string
  preview_url: string | null
  thumbnail_url: string | null
  created_at: string
  view_count?: number | null
  processing_status?: string | null
}

type Props = {
  initialPhotos: Photo[]
  totalCount: number
  albumTitle: string
  albumId: string
  initialCursor: string | null
}

export default function PublicGalleryInfinite({
  initialPhotos,
  totalCount,
  albumTitle,
  albumId,
  initialCursor,
}: Props) {
  const [photos, setPhotos] = useState(initialPhotos)
  const [cursor, setCursor] = useState(initialCursor)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(Boolean(initialCursor))
  const loaderRef = useRef<HTMLDivElement | null>(null)

  async function loadMore() {
    if (loading || !hasMore || !cursor) return

    try {
      setLoading(true)

      const res = await fetch(
        `/api/share/photos?albumId=${albumId}&cursor=${encodeURIComponent(
          cursor
        )}&limit=50`,
        { cache: 'no-store' }
      )

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Load more failed')
      }

      setPhotos((prev) => [...prev, ...(data.photos || [])])
      setCursor(data.nextCursor)
      setHasMore(Boolean(data.hasMore))
    } catch (error) {
      console.error(error)
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const target = loaderRef.current
    if (!target) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore()
        }
      },
      {
        rootMargin: '600px',
      }
    )

    observer.observe(target)

    return () => observer.disconnect()
  }, [cursor, hasMore, loading])

  return (
    <>
     <PublicGallery
  photos={photos.filter((photo) => Boolean(photo.public_url))}
  totalCount={totalCount}
  albumTitle={albumTitle}
  albumId={albumId}
/>

      <div ref={loaderRef} className="py-8 text-center">
        {loading ? (
          <p className="text-sm text-slate-400">Loading more photos...</p>
        ) : hasMore ? (
          <p className="text-xs text-slate-300">Scroll to load more</p>
        ) : (
          <p className="text-xs text-slate-300">End of album</p>
        )}
      </div>
    </>
  )
}