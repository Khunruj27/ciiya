'use client'

import { useState } from 'react'
import Image from 'next/image'

type Photo = {
  id: string
  public_url: string
  filename: string
  blur_data_url?: string | null
}

type Props = {
  albumId: string
  albumTitle: string
  photos: Photo[]
}

export default function AlbumManagement({
  albumTitle,
  photos,
}: Props) {
  const [activeTab, setActiveTab] = useState<'photos' | 'videos'>('photos')

  return (
    <div className="min-h-screen bg-[#F7F8FA] pb-24">
      
      {/* 🔥 HEADER */}
      <div className="sticky top-0 z-20 bg-white px-4 py-4 border-b">
        <div className="flex items-center justify-between">
          <button onClick={() => history.back()}>←</button>

          <h1 className="text-lg font-semibold">
            Album Management
          </h1>

          <button>↗</button>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <h2 className="text-xl font-semibold">{albumTitle}</h2>
          <button className="text-blue-500">✎</button>
        </div>
      </div>

      {/* 🔥 TABS */}
      <div className="bg-white px-4 pt-3">
        <div className="flex items-center gap-6 text-sm">
          <button
            onClick={() => setActiveTab('photos')}
            className={`pb-2 ${
              activeTab === 'photos'
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-muted'
            }`}
          >
            Photos ({photos.length})
          </button>

          <button
            onClick={() => setActiveTab('videos')}
            className="pb-2 text-muted"
          >
            Videos (0)
          </button>

          <div className="ml-auto flex gap-3 text-muted">
            <button>Sort</button>
            <button>Filters</button>
          </div>
        </div>
      </div>

      {/* 🔥 CATEGORY BAR */}
      <div className="bg-white px-4 py-3 flex items-center justify-between">
        <span className="text-blue-500">Category 1</span>
        <button className="border px-3 py-1 rounded-full text-sm text-blue-500">
          + Category
        </button>
      </div>

      {/* 🔥 GRID */}
      <div className="grid grid-cols-3 gap-[2px] bg-ground-sunken">
        {photos.map((photo) => (
          <div key={photo.id} className="bg-white">
            <div className="relative aspect-square w-full">
              <Image
                src={photo.public_url}
                alt="Album cover preview"
                fill
                sizes="33vw"
                unoptimized
                className="object-cover"
              />
            </div>

            <div className="p-1 text-[10px] text-center text-muted truncate">
              {photo.filename}
            </div>
          </div>
        ))}
      </div>

      {/* 🔥 FLOATING UPLOAD BUTTON */}
      <button
        onClick={() => {
          document.getElementById('uploadInput')?.click()
        }}
        className="fixed bottom-6 right-4 bg-blue-600 text-white px-6 py-3 rounded-full shadow-xl text-sm"
      >
        Upload
      </button>

      {/* 🔥 HIDDEN INPUT */}
      <input
        id="uploadInput"
        type="file"
        multiple
        className="hidden"
      />
    </div>
  )
}