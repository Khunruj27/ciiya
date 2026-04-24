'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-client'

type Photo = {
  id: string
  public_url: string
  filename?: string | null
  view_count?: number | null
  trending_score?: number | null
  created_at?: string | null
}

type Props = {
  photos: Photo[]
  albumTitle: string
  albumId?: string
}

type TabMode = 'live' | 'trending'

function getBadge(photo: Photo) {
  const views = photo.view_count || 0

  if (views >= 30) {
    return {
      label: '⭐ Top Pick',
      className: 'bg-amber-500 text-white',
    }
  }

  if (views >= 15) {
    return {
      label: '🚀 Viral',
      className: 'bg-fuchsia-500 text-white',
    }
  }

  if (views >= 5) {
    return {
      label: '🔥 Hot',
      className: 'bg-red-500 text-white',
    }
  }

  return null
}

export default function PublicGallery({
  photos: initialPhotos,
  albumTitle,
  albumId,
}: Props) {
  const supabase = createClient()

  const [photos, setPhotos] = useState<Photo[]>(initialPhotos || [])
  const [tabMode, setTabMode] = useState<TabMode>('live')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  useEffect(() => {
    setPhotos(initialPhotos || [])
  }, [initialPhotos])

  useEffect(() => {
    const channel = supabase
      .channel(`photos-realtime-${albumId || 'public'}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'photos',
        },
        (payload) => {
          const updated = payload.new as Photo & { album_id?: string }

          if (albumId && updated.album_id && updated.album_id !== albumId) return

          setPhotos((prev) =>
            prev.map((photo) =>
              photo.id === updated.id ? { ...photo, ...updated } : photo
            )
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'photos',
        },
        (payload) => {
          const inserted = payload.new as Photo & { album_id?: string }

          if (albumId && inserted.album_id && inserted.album_id !== albumId) return

          setPhotos((prev) => {
            const exists = prev.some((photo) => photo.id === inserted.id)
            if (exists) return prev
            return [inserted, ...prev]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, albumId])

  const displayPhotos = useMemo(() => {
    if (tabMode === 'live') {
      return [...photos].sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
        return dateB - dateA
      })
    }

    return [...photos].sort((a, b) => {
      const scoreA = a.trending_score ?? a.view_count ?? 0
      const scoreB = b.trending_score ?? b.view_count ?? 0
      return scoreB - scoreA
    })
  }, [photos, tabMode])

  const selectedPhoto =
    selectedIndex !== null ? displayPhotos[selectedIndex] : null

  const currentLabel = useMemo(() => {
    if (selectedIndex === null) return ''
    return `${selectedIndex + 1} / ${displayPhotos.length}`
  }, [selectedIndex, displayPhotos.length])

  async function trackView(photoId: string) {
    try {
      await fetch('/api/photos/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId }),
      })
    } catch {}
  }

  function openPhoto(index: number, photoId: string) {
    setSelectedIndex(index)
    trackView(photoId)
  }

  function closeModal() {
    setSelectedIndex(null)
  }

  function showPrev() {
    if (selectedIndex === null) return
    setSelectedIndex(
      (selectedIndex - 1 + displayPhotos.length) % displayPhotos.length
    )
  }

  function showNext() {
    if (selectedIndex === null) return
    setSelectedIndex((selectedIndex + 1) % displayPhotos.length)
  }

  return (
    <>
      <div className="rounded-[32px] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTabMode('live')}
              className={`rounded-full px-5 py-2.5 text-sm font-medium ${
                tabMode === 'live'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              Live
            </button>

            <button
              type="button"
              onClick={() => setTabMode('trending')}
              className={`rounded-full px-5 py-2.5 text-sm font-medium ${
                tabMode === 'trending'
                  ? 'bg-red-500 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              Trending 🔥
            </button>
          </div>

          <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500">
            {displayPhotos.length} items
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {displayPhotos.map((photo, index) => {
          const badge = getBadge(photo)

          return (
            <div
              key={photo.id}
              className="overflow-hidden rounded-[30px] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-black/5 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(15,23,42,0.12)]"
            >
              <div className="relative">
                {badge ? (
                  <div
                    className={`absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-[11px] font-medium shadow ${badge.className}`}
                  >
                    {badge.label}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => openPhoto(index, photo.id)}
                  className="block w-full"
                >
                  <div className="aspect-[4/5] w-full bg-slate-100">
                    <img
                      src={photo.public_url}
                      alt={photo.filename || 'photo'}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  </div>
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <p className="min-w-0 truncate text-sm text-slate-600">
                  {photo.filename || 'Photo'}
                </p>

                <span className="shrink-0 rounded-full bg-slate-50 px-2 py-1 text-[11px] text-slate-400">
                  👁 {photo.view_count || 0}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {selectedPhoto ? (
        <div className="fixed inset-0 z-50 bg-black/95">
          <div className="flex h-full flex-col">
            <div className="sticky top-0 z-10 border-b border-white/10 bg-black/60 backdrop-blur">
              <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 text-white">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{albumTitle}</p>
                  <p className="text-xs text-white/60">
                    {selectedPhoto.filename || 'Photo'}
                  </p>
                </div>

                <div className="ml-4 flex items-center gap-2">
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
                    {currentLabel}
                  </span>

                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-full bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-center px-3 py-4">
              <div className="flex w-full max-w-6xl items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={showPrev}
                  className="shrink-0 rounded-full bg-white/10 px-4 py-3 text-white hover:bg-white/20"
                >
                  ←
                </button>

                <div className="flex flex-1 items-center justify-center">
                  <div className="flex h-[80vh] w-full items-center justify-center rounded-3xl bg-transparent">
                    <img
                      src={selectedPhoto.public_url}
                      alt={selectedPhoto.filename || 'Photo'}
                      className="max-h-full max-w-full object-contain shadow-2xl"
                      draggable={false}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={showNext}
                  className="shrink-0 rounded-full bg-white/10 px-4 py-3 text-white hover:bg-white/20"
                >
                  →
                </button>
              </div>
            </div>

            <div className="border-t border-white/10 bg-black/60 px-4 py-3 text-center text-xs text-white/60 backdrop-blur">
              Tap arrows to browse through the gallery · Long press image to save
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}