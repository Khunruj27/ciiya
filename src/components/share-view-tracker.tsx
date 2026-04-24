'use client'

import { useEffect } from 'react'

type Props = {
  token: string
}

export default function ShareViewTracker({ token }: Props) {
  useEffect(() => {
    const key = `racky_viewed_${token}`
    const alreadyViewed = window.sessionStorage.getItem(key)

    if (alreadyViewed) return

    fetch('/api/share/view', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    }).catch(() => {})

    window.sessionStorage.setItem(key, 'true')
  }, [token])

  return null
}