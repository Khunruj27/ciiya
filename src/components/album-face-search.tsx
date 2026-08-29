'use client'

import { useRef, useState } from 'react'
import NextImage from 'next/image'
import { extractSelfieDescriptor } from '@/lib/face-descriptor'

type MatchPhoto = {
  id: string
  filename?: string
  imageUrl?: string
  thumbnailUrl?: string
}

type FaceSearchResult = {
  faceId: string
  photoId: string
  score: number
  confidence: number
  photo: MatchPhoto
}

type Props = {
  albumId: string
  token?: string
}

export default function AlbumFaceSearch({ albumId, token = '' }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [matches, setMatches] = useState<FaceSearchResult[]>([])
  const [previewUrl, setPreviewUrl] = useState('')

  async function handleSearch(file: File | null) {
    if (!file) return

    setLoading(true)
    setError('')
    setMatches([])
    setPreviewUrl('')

    try {
      const result = await extractSelfieDescriptor(file)

      setPreviewUrl(result.previewUrl)

      if (!token) {
  throw new Error('Missing share token')
}

      const res = await fetch('/api/faces/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
  albumId,
  token,
  descriptor: result.descriptor,
  limit: 80,
}),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || 'Search failed')
      }

      setMatches(json.results || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="px-4 pt-4">
      <div className="rounded-[28px] border border-line bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Face Search</h3>

            <p className="mt-1 text-xs text-muted">
              Upload a face photo to find your pictures in the album
            </p>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="rounded-full bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="hidden"
            onChange={(e) => {
              handleSearch(e.target.files?.[0] || null)
              e.currentTarget.value = ''
            }}
          />
        </div>

        {previewUrl && (
          <div className="mt-4 flex items-center gap-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl">
              <NextImage
                src={previewUrl}
                alt="preview"
                fill
                unoptimized
                className="object-cover"
              />
            </div>

            <div className="text-xs text-muted">
              {loading ? 'Searching...' : `Found ${matches.length} photos`}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-2xl bg-red-50 p-3 text-xs text-red-600">
            {error}
          </div>
        )}

        {matches.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {matches.map((item) => {
              const imageUrl = item.photo?.thumbnailUrl || item.photo?.imageUrl

              if (!imageUrl) return null

              return (
                <a
                  key={item.faceId}
                  href={item.photo?.imageUrl || imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-square overflow-hidden rounded-2xl bg-ground-sunken"
                >
                  <NextImage
                    src={imageUrl}
                    alt={item.photo?.filename || 'match'}
                    fill
                    unoptimized
                    sizes="33vw"
                    className="object-cover"
                  />
                </a>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}