'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Props = {
  albumId: string
}

export default function FaceClusterButton({ albumId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleCluster() {
    if (loading) return

    try {
      setLoading(true)
      setMessage('')

      const res = await fetch('/api/faces/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumId }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setMessage(data?.error || 'Cluster failed')
        return
      }

      setMessage(`People: ${data.clusters ?? 0} / Faces: ${data.faces ?? 0}`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cluster failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleCluster}
        disabled={loading}
        className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
      >
        {loading ? 'Clustering...' : 'Cluster People'}
      </button>

      {message ? (
        <p className="text-[11px] text-muted">
          {message}
        </p>
      ) : null}
    </div>
  )
}