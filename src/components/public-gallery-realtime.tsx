'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

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

  created_at: string
  view_count?: number | null
  processing_status?: string | null
  blur_data_url?: string | null
}

type Props = {
  albumId: string
  onPhotosDone?: (photos: Photo[]) => void
}

export default function PublicGalleryRealtime({
  albumId,
  onPhotosDone,
}: Props) {
  const router = useRouter()

  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pendingIdsRef = useRef<Set<string>>(new Set())
  const processedIdsRef = useRef<Set<string>>(new Set())

  const isWaitingRef = useRef(false)
  const isFlushingRef = useRef(false)
  const mountedRef = useRef(false)
  

  const MAX_PROCESSED_IDS = 500

function rememberProcessedId(photoId: string) {
  processedIdsRef.current.add(photoId)

  if (processedIdsRef.current.size <= MAX_PROCESSED_IDS) {
    return
  }

  const firstId =
    processedIdsRef.current.values().next().value

  if (firstId) {
    processedIdsRef.current.delete(firstId)
  }
}

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

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

    function clearTimers() {
      if (quietTimerRef.current) {
        clearTimeout(quietTimerRef.current)
        quietTimerRef.current = null
      }

      if (maxTimerRef.current) {
        clearTimeout(maxTimerRef.current)
        maxTimerRef.current = null
      }
    }

    async function flushStableUpdate() {
      if (isFlushingRef.current) return

      const ids = Array.from(pendingIdsRef.current)

      if (ids.length === 0) {
        isWaitingRef.current = false
        clearTimers()
        return
      }

      isFlushingRef.current = true
      pendingIdsRef.current.clear()
      isWaitingRef.current = false
      clearTimers()

      try {
        if (!mountedRef.current) return

        if (!onPhotosDone) {
          router.refresh()
          return
        }

        const { data, error } = await supabase
          .from('photos')
          .select(
  `
  id,
  album_id,
  filename,
  public_url,
  original_url,
  preview_url,
  thumbnail_url,
  sd_url,
  hd_url,
  uhd_url,
  blur_data_url,
  created_at,
  view_count,
  processing_status
  `
)
          .in('id', ids)
          .eq('processing_status', 'done')
          .not('public_url', 'is', null)
          .not('preview_url', 'is', null)
          .not('thumbnail_url', 'is', null)
          .order('created_at', { ascending: false })

        if (error) {
  console.error('[PublicGalleryRealtime]', error.message)

  if (!onPhotosDone) {
    router.refresh()
  }

  return
}

        if (!data?.length) return

        data.forEach((photo) => {
          rememberProcessedId(photo.id)
        })

        onPhotosDone(data as Photo[])
      } finally {
        isFlushingRef.current = false

        if (pendingIdsRef.current.size > 0) {
          quietTimerRef.current = setTimeout(() => {
            flushStableUpdate()
          }, 1200)
        }
      }
    }

    function scheduleStableUpdate(photoId: string) {
      if (processedIdsRef.current.has(photoId)) return

      pendingIdsRef.current.add(photoId)

      if (quietTimerRef.current) {
        clearTimeout(quietTimerRef.current)
      }

      quietTimerRef.current = setTimeout(() => {
        flushStableUpdate()
      }, 1200)

      if (!isWaitingRef.current) {
        isWaitingRef.current = true

        maxTimerRef.current = setTimeout(() => {
          flushStableUpdate()
        }, 5000)
      }
    }

    const channel = supabase
      .channel(`public-photos:${albumId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'photos',
          filter: `album_id=eq.${albumId}`,
        },
        (payload) => {
          const record = payload.new as {
            id?: string
            processing_status?: string | null
            public_url?: string | null
            preview_url?: string | null
            thumbnail_url?: string | null
          } | null

          if (!record?.id) return

          if (
            record.processing_status === 'done' &&
            record.public_url &&
            record.preview_url &&
            record.thumbnail_url
          ) {
            scheduleStableUpdate(record.id)
          }
        }
      )
      .subscribe()

   const pendingIds = pendingIdsRef.current
   const processedIds = processedIdsRef.current

    return () => {
  clearTimers()
  pendingIds.clear()
  processedIds.clear()
  void supabase.removeChannel(channel)
}
  }, [albumId, onPhotosDone, router])

  return null
}