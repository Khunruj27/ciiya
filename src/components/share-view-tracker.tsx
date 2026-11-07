'use client'

import { useEffect } from 'react'
import { trackShareView } from '@/lib/share-view-tracking'

type Props = {
  token: string
}

export default function ShareViewTracker({ token }: Props) {
  useEffect(() => {
    if (!token) return
    const track = () => { void trackShareView(token) }
    track()
    window.addEventListener('online', track)
    window.addEventListener('focus', track)
    return () => {
      window.removeEventListener('online', track)
      window.removeEventListener('focus', track)
    }
  }, [token])

  return null
}
