'use client'

import { useEffect, useRef } from 'react'

type Props = {
  token: string
}

export default function ShareViewTracker({ token }: Props) {
  const sentRef = useRef(false)

  useEffect(() => {
    if (!token) return

    if (sentRef.current) return

    const key = `ciiya_viewed_${token}`

    try {
      const alreadyViewed =
        typeof window !== 'undefined'
          ? window.sessionStorage.getItem(key)
          : null

      if (alreadyViewed) {
        sentRef.current = true
        return
      }

      sentRef.current = true

      const controller = new AbortController()

      const timeout = setTimeout(() => {
        controller.abort()
      }, 5000)

      fetch('/api/share/view', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
        signal: controller.signal,
        keepalive: true,
      })
        .catch(() => {})
        .finally(() => {
          clearTimeout(timeout)
        })

      window.sessionStorage.setItem(key, 'true')

      return () => {
        clearTimeout(timeout)
      }
    } catch {
      // silent fail
    }
  }, [token])

  return null
}