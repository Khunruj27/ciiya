'use client'

import { useEffect, useRef } from 'react'
import { getPublicRealtimeClient } from '@/lib/supabase-browser'

type UseRealtimePhotosOptions = {
  albumId?: string
  delayMs?: number
}

export function useRealtimePhotos(
  onUpdate: () => void,
  options: UseRealtimePhotosOptions = {}
) {
  const onUpdateRef = useRef(onUpdate)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const albumId = options.albumId
  const delayMs = options.delayMs ?? 1200

  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  useEffect(() => {
    const supabase = getPublicRealtimeClient()

    const channel = supabase
      .channel(albumId ? `photos-realtime:${albumId}` : 'photos-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'photos',
          ...(albumId ? { filter: `album_id=eq.${albumId}` } : {}),
        },
        () => {
          if (timerRef.current) {
            clearTimeout(timerRef.current)
          }

          timerRef.current = setTimeout(() => {
            onUpdateRef.current()
          }, delayMs)
        }
      )
      .subscribe()

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      supabase.removeChannel(channel)
    }
  }, [albumId, delayMs])
}