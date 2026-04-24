'use client'

import { useEffect, useState } from 'react'

export default function UploadDashboard() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch('/api/photos/count')
      const data = await res.json()
      setCount(data.total || 0)
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="bg-white p-4 rounded-3xl shadow-sm">
      <h3 className="text-sm font-semibold">Upload Status</h3>
      <p className="text-xl mt-2">📸 {count} photos</p>
    </div>
  )
}