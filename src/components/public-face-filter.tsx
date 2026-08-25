'use client'

import { useEffect, useMemo, useState } from 'react'

type FaceCluster = {
  id: string
  label: string
  face_count: number
  photo_ids: string[]
}

type Props = {
  token: string
  onChange: (photoIds: string[] | null) => void
}

export default function PublicFaceFilter({ token, onChange }: Props) {
  const [clusters, setClusters] = useState<FaceCluster[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadFaces() {
      try {
        const res = await fetch(`/api/share/faces?token=${token}`, {
          cache: 'no-store',
        })

        const data = await res.json()

        if (res.ok) {
          setClusters(data.clusters || [])
        }
      } finally {
        setLoading(false)
      }
    }

    loadFaces()
  }, [token])

  const activeCluster = useMemo(() => {
    return clusters.find((cluster) => cluster.id === activeId) || null
  }, [clusters, activeId])

  function handleSelect(cluster: FaceCluster) {
    if (activeId === cluster.id) {
      setActiveId(null)
      onChange(null)
      return
    }

    setActiveId(cluster.id)
    onChange(cluster.photo_ids)
  }

  if (loading) {
    return (
      <div className="px-4 py-3 text-xs text-muted">
        Loading people...
      </div>
    )
  }

  if (clusters.length === 0) return null

  return (
    <div className="sticky top-0 z-20 border-b border-line bg-white/90 px-4 py-3 backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-bold text-ink">Search by Face</p>

        {activeCluster ? (
          <button
            type="button"
            onClick={() => {
              setActiveId(null)
              onChange(null)
            }}
            className="text-xs font-semibold text-blue-600"
          >
            Show all
          </button>
        ) : null}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {clusters.map((cluster, index) => {
          const active = activeId === cluster.id

          return (
            <button
              key={cluster.id}
              type="button"
              onClick={() => handleSelect(cluster)}
              className={[
                'shrink-0 rounded-full px-4 py-2 text-xs font-bold transition active:scale-95',
                active
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'bg-ground-sunken text-ink-soft',
              ].join(' ')}
            >
              {cluster.label || `Person ${index + 1}`}
              <span className={active ? 'ml-1 text-white/80' : 'ml-1 text-muted'}>
                {cluster.photo_ids.length}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}