'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase-browser'

type Props = {
  albumId: string
}

type PhotoRealtimeRecord = {
  id?: string
  processing_progress?: number | null
  processing_status?: string | null
  updated_at?: string | null
}

type RealtimePayload = {
  new: PhotoRealtimeRecord | null
}

export default function AlbumRealtimeRefresher({ albumId }: Props) {
  const router = useRouter()
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const lastPayloadRef = useRef<string>('')

  useEffect(() => {
    if (!albumId) return

    const supabase = getSupabaseBrowserClient()

    const refreshSoftly = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      timerRef.current = setTimeout(() => {
        router.refresh()
      }, 500)
    }

    const channel = supabase
      .channel(`album-photos-${albumId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photos',
          filter: `album_id=eq.${albumId}`,
        },
        (payload: RealtimePayload) => {
          const nextRecord = payload.new

          if (!nextRecord) return

          const stateKey = JSON.stringify({
            id: nextRecord.id,
            progress: nextRecord.processing_progress,
            status: nextRecord.processing_status,
            updatedAt: nextRecord.updated_at,
          })

          if (lastPayloadRef.current === stateKey) {
            return
          }

          lastPayloadRef.current = stateKey
          refreshSoftly()
        }
      )
      .subscribe((status: string) => {
        console.log(`[Realtime] album ${albumId}:`, status)
      })

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      supabase.removeChannel(channel)
    }
  }, [albumId, router])

  return null
}