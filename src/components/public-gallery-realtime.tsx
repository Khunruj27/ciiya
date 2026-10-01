'use client'

import { useEffect } from 'react'
import { overlapPhotoUpdateTimestamp, type PhotoUpdateCursor, type SharedPhoto } from '@/lib/share-photo-updates'

type Props = {
  shareToken: string
  initialSince: string
  onPhotosDone: (photos: SharedPhoto[]) => void
  onAccessLost: () => void
}

// Guest RLS intentionally disallows direct photos reads. Poll the token-gated
// API instead of subscribing with an anonymous Supabase client. Completion is
// ordered by updated_at, not upload time: slow Worker jobs must not be missed.
export default function PublicGalleryRealtime({ shareToken, initialSince, onPhotosDone, onAccessLost }: Props) {
  useEffect(() => {
    if (!shareToken) return
    let stopped = false
    let running = false
    let since = initialSince
    let cursor: PhotoUpdateCursor | null = null
    let latestUpdatedAt: string | null = null
    let failures = 0
    let retryNotBefore = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const active = () => !stopped && document.visibilityState !== 'hidden' && navigator.onLine
    const schedule = (delay: number) => {
      clearTimeout(timer)
      if (active()) timer = setTimeout(poll, delay)
    }

    async function poll() {
      if (!active() || running) return
      if (Date.now() < retryNotBefore) {
        schedule(retryNotBefore - Date.now())
        return
      }
      running = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 15_000)
      let delay = 5_000
      try {
        const params = new URLSearchParams({ token: shareToken, since })
        if (cursor) params.set('cursor', JSON.stringify(cursor))
        const response = await fetch(`/api/share/photos/updates?${params}`, {
          cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        })
        if (stopped) return
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          stopped = true
          onAccessLost()
          return
        }
        if (response.status === 429) {
          const retry = response.headers.get('Retry-After')
          const seconds = Number(retry)
          const retryDelay = retry && Number.isFinite(seconds)
            ? seconds * 1000 : Date.parse(retry || '') - Date.now()
          retryNotBefore = Date.now() + Math.max(5_000, Number.isFinite(retryDelay) ? retryDelay : 60_000)
          throw new Error('Rate limited')
        }
        if (!response.ok) throw new Error('Photo update failed')
        const data = await response.json()
        if (stopped) return
        if (!data.success || !Array.isArray(data.photos)) throw new Error('Invalid photo update')
        onPhotosDone(data.photos)
        if (data.latestUpdatedAt) latestUpdatedAt = data.latestUpdatedAt
        cursor = data.nextCursor || null
        if (!cursor && latestUpdatedAt) {
          // Advance only after all pages succeed; replay on failures is safe.
          const nextSince = overlapPhotoUpdateTimestamp(latestUpdatedAt)
          if (Date.parse(nextSince) > Date.parse(since)) since = nextSince
          latestUpdatedAt = null
        }
        failures = 0
        delay = cursor ? 250 : 5_000
      } catch {
        failures += 1
        delay = Math.max(Math.min(5_000 * 2 ** Math.min(failures - 1, 4), 60_000), retryNotBefore - Date.now())
      } finally {
        clearTimeout(timeout)
        running = false
        schedule(delay)
      }
    }

    function resume() {
      clearTimeout(timer)
      if (active()) void poll()
      else controller?.abort()
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    window.addEventListener('offline', resume)
    window.addEventListener('focus', resume)
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', resume)
      window.removeEventListener('focus', resume)
    }
  }, [shareToken, initialSince, onPhotosDone, onAccessLost])
  return null
}
