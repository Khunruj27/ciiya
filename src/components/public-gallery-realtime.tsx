'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

export default function PublicGalleryRealtime({
  albumId,
}: {
  albumId: string
}) {
  const router = useRouter()
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey || !albumId) return

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    function scheduleRefresh() {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }

      refreshTimerRef.current = setTimeout(() => {
        router.refresh()
      }, 2500)
    }

    const channel = supabase
      .channel(`public-photos:${albumId}`)
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
          event: 'UPDATE',
          schema: 'public',
          table: 'photos',
          filter: `album_id=eq.${albumId}`,
        },
        (payload) => {
          const nextRecord = payload.new as {
            processing_status?: string | null
          }

          if (nextRecord.processing_status === 'done') {
            scheduleRefresh()
          }
        }
      )
      .subscribe()

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }

      supabase.removeChannel(channel)
    }
  }, [albumId, router])

  return null
}