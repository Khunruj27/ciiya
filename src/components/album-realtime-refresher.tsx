'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

type Props = {
  albumId: string
}

const REFRESH_DELAY_MS = 1200

export default function AlbumRealtimeRefresher({ albumId }: Props) {
  const router = useRouter()
  const refreshTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()

    function scheduleRefresh() {
      if (refreshTimeout.current) {
        clearTimeout(refreshTimeout.current)
      }

      refreshTimeout.current = setTimeout(() => {
        router.refresh()
      }, REFRESH_DELAY_MS)
    }

    const channel = supabase
      .channel(`album-live-${albumId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'photos',
          filter: `album_id=eq.${albumId}`,
        },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'camera_live_imports',
          filter: `album_id=eq.${albumId}`,
        },
        scheduleRefresh
      )
      .subscribe()

    return () => {
      if (refreshTimeout.current) {
        clearTimeout(refreshTimeout.current)
      }

      void supabase.removeChannel(channel)
    }
  }, [albumId, router])

  return null
}