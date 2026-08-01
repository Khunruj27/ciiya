'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

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
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) return

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

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