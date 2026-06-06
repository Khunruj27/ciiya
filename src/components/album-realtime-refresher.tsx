'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

type Props = {
  albumId: string
}

export default function AlbumRealtimeRefresher({
  albumId,
}: Props) {
  const router = useRouter()

  const refreshTimeout = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`album-${albumId}`)

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photos',
          filter: `album_id=eq.${albumId}`,
        },
        (payload) => {
          const next = payload.new as
            | {
                processing_status?: string
              }
            | undefined

          const status = next?.processing_status

          // refresh เฉพาะสถานะสำคัญ
          const shouldRefresh =
            status === 'done' ||
            status === 'failed'

          if (!shouldRefresh) {
            return
          }

          // debounce refresh
          if (refreshTimeout.current) {
            clearTimeout(refreshTimeout.current)
          }

          refreshTimeout.current = setTimeout(() => {
            router.refresh()
          }, 2500)
        }
      )

      .subscribe()

    return () => {
      if (refreshTimeout.current) {
        clearTimeout(refreshTimeout.current)
      }

      supabase.removeChannel(channel)
    }
  }, [albumId, router])

  return null
}