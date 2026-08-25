'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import PublicFaceFilter from '@/components/public-face-filter'

type Photo = {
  id: string
  public_url?: string | null
  preview_url?: string | null
  thumbnail_url?: string | null
  file_name?: string | null
  blur_data_url?: string | null
}

type Props = {
  token: string
  photos: Photo[]
}

export default function PublicShareClient({ token, photos }: Props) {
  const [filterPhotoIds, setFilterPhotoIds] = useState<string[] | null>(null)

  const filteredPhotos = useMemo(() => {
    if (!filterPhotoIds) return photos

    const allowed = new Set(filterPhotoIds)
    return photos.filter((photo) => allowed.has(photo.id))
  }, [photos, filterPhotoIds])

  return (
    <>
      <PublicFaceFilter token={token} onChange={setFilterPhotoIds} />

      <div className="grid grid-cols-3 gap-1 px-2 py-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {filteredPhotos.map((photo) => {
          const src = photo.thumbnail_url || photo.preview_url || ''

          if (!src) return null

          return (
            <button
              key={photo.id}
              type="button"
              className="group relative aspect-square overflow-hidden bg-ground-sunken"
            >
              <Image
                src={src}
                alt={photo.file_name || 'Photo'}
                fill
                sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 16vw"
                className="object-cover transition duration-300 group-active:scale-95"
                loading="lazy"
              />
            </button>
          )
        })}
      </div>

      {filteredPhotos.length === 0 ? (
        <div className="px-6 py-16 text-center text-sm text-muted">
          No photos found for this person.
        </div>
      ) : null}
    </>
  )
}