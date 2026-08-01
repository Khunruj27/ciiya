'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import FaceSearchButton from './face-search-button'
import FaceSearchPanel from './face-search-panel'

type Photo = {
  id: string
  thumbnail_url?: string | null
  preview_url?: string | null
  public_url?: string | null
  blur_data_url?: string | null
}

type Props = {
  token: string
  photos: Photo[]
}

export default function ShareClient({
  token,
  photos,
}: Props) {
  const [filterIds, setFilterIds] = useState<string[] | null>(null)
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!filterIds) return photos

    const ids = new Set(filterIds)

    return photos.filter((photo) =>
      ids.has(photo.id)
    )
  }, [photos, filterIds])

  return (
    <>
      <FaceSearchButton onClick={() => setOpen(true)} />

      {open && (
        <FaceSearchPanel
          token={token}
          onSelect={setFilterIds}
          onClose={() => setOpen(false)}
        />
      )}

      <div className="grid grid-cols-3 gap-1 p-2">
        {filtered.map((photo) => {
          const src =
            photo.thumbnail_url ||
            photo.preview_url ||
            ''

          if (!src) return null

          return (
            <div key={photo.id} className="relative aspect-square">
              <Image
                src={src}
                alt=""
                fill
                sizes="33vw"
                loading="lazy"
                className="object-cover"
              />
            </div>
          )
        })}
      </div>
    </>
  )
}