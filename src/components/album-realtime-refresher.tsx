'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

type Props = {
  albumId: string
}

type RefreshPriority = 'normal' | 'fast'

const NORMAL_REFRESH_DELAY_MS = 3000
const FAST_REFRESH_DELAY_MS = 900

export default function AlbumRealtimeRefresher({ albumId }: Props) {
  const router = useRouter()
  const refreshTimeout = useRef<NodeJS.Timeout | null>(null)
  const lastRefreshAt = useRef(0)

  useEffect(() => {
    const supabase = createClient()

    function scheduleRefresh(priority: RefreshPriority = 'normal') {
      const now = Date.now()
      const elapsed = now - lastRefreshAt.current
      const delay =
        priority === 'fast' ? FAST_REFRESH_DELAY_MS : NORMAL_REFRESH_DELAY_MS

      if (refreshTimeout.current) {
        clearTimeout(refreshTimeout.current)
      }

      refreshTimeout.current = setTimeout(
        () => {
          lastRefreshAt.current = Date.now()
          router.refresh()
        },
        elapsed > delay ? 350 : delay
      )
    }

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
                face_scan_status?: string
              }
            | undefined

          const status = next?.processing_status
          const faceStatus = next?.face_scan_status

          if (
            status === 'done' ||
            status === 'failed' ||
            faceStatus === 'done' ||
            faceStatus === 'failed'
          ) {
            scheduleRefresh('fast')
            return
          }

          if (
            status === 'pending' ||
            status === 'processing' ||
            faceStatus === 'pending' ||
            faceStatus === 'processing'
          ) {
            scheduleRefresh('normal')
          }
        }
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photo_jobs',
          filter: `album_id=eq.${albumId}`,
        },
        (payload) => {
          const next = payload.new as
            | {
                status?: string
              }
            | undefined

          if (next?.status === 'done' || next?.status === 'failed') {
            scheduleRefresh('fast')
            return
          }

          scheduleRefresh('normal')
        }
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'face_jobs',
          filter: `album_id=eq.${albumId}`,
        },
        (payload) => {
          const next = payload.new as
            | {
                status?: string
              }
            | undefined

          if (next?.status === 'done' || next?.status === 'failed') {
            scheduleRefresh('fast')
            return
          }

          scheduleRefresh('normal')
        }
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'camera_live_imports',
          filter: `album_id=eq.${albumId}`,
        },
        (payload) => {
          const next = payload.new as
            | {
                status?: string
              }
            | undefined

          if (
            next?.status === 'done' ||
            next?.status === 'failed' ||
            next?.status === 'finalizing'
          ) {
            scheduleRefresh('fast')
            return
          }

          scheduleRefresh('normal')
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