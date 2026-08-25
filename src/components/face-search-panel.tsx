'use client'

import { useEffect, useState } from 'react'

type Cluster = {
  id: string
  label: string
  photo_ids: string[]
}

type Props = {
  token: string
  onSelect: (ids: string[] | null) => void
  onClose: () => void
}

export default function FaceSearchPanel({ token, onSelect, onClose }: Props) {
  const [clusters, setClusters] = useState<Cluster[]>([])

  useEffect(() => {
    fetch(`/api/share/faces?token=${token}`)
      .then((r) => r.json())
      .then((d) => setClusters(d.clusters || []))
  }, [token])

  return (
    <div className="fixed inset-0 z-50 bg-black/40">
      <div className="absolute bottom-0 w-full rounded-t-2xl bg-white p-4">
        <div className="mb-3 flex justify-between">
          <b>เลือกบุคคล</b>
          <button onClick={onClose}>ปิด</button>
        </div>

        <div className="flex gap-2 overflow-x-auto">
          {clusters.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c.photo_ids)
                onClose()
              }}
              className="rounded-full bg-ground-sunken px-4 py-2 text-sm"
            >
              {c.label} ({c.photo_ids.length})
            </button>
          ))}
        </div>

        <button
          onClick={() => {
            onSelect(null)
            onClose()
          }}
          className="mt-4 w-full text-sm text-blue-600"
        >
          แสดงทั้งหมด
        </button>
      </div>
    </div>
  )
}