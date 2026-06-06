'use client'

import { useEffect, useState } from 'react'

export default function UploadDashboard() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let mounted = true

    async function fetchCount() {
      try {
        const res = await fetch('/api/photos/count', {
          cache: 'no-store',
        })

        if (!res.ok) return

        const data = await res.json()

        if (mounted) {
          setCount(data.total || 0)
        }
      } catch (error) {
        console.error('UploadDashboard fetch error', error)
      }
    }

    fetchCount()

    const interval = setInterval(fetchCount, 15000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="rounded-3xl bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold">Upload Status</h3>

      <p className="mt-2 text-xl">
        📸 {count} photos
      </p>
    </div>
  )
}