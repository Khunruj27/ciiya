'use client'

import { useRef, useState } from 'react'
import NextImage from 'next/image'

type FaceApiModule = typeof import('@vladmandic/face-api')

let faceapi: FaceApiModule | null = null

let modelsLoaded = false

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

async function loadFaceModels() {
  if (modelsLoaded) return

  if (!faceapi) {
    faceapi = await import('@vladmandic/face-api')
  }

  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
  ])

  modelsLoaded = true
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Couldn’t read the image file'))
      }
    }

    reader.onerror = () => {
      reject(new Error('Couldn’t read the image file'))
    }

    reader.readAsDataURL(file)
  })
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()

    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Can’t open this photo'))

    img.src = src
  })
}

async function normalizeImageFile(file: File) {
  const dataUrl = await fileToDataUrl(file)
  const img = await loadImage(dataUrl)

  const canvas = document.createElement('canvas')
  const maxSize = 1200

  const scale = Math.min(
    1,
    maxSize / Math.max(img.naturalWidth, img.naturalHeight)
  )

  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))

  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Browser Unsupported canvas')
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const normalizedDataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const normalizedImg = await loadImage(normalizedDataUrl)

  return {
    img: normalizedImg,
    previewUrl: normalizedDataUrl,
  }
}

async function extractDescriptor(file: File) {
  await loadFaceModels()

  if (!faceapi) {
    throw new Error('Face API not loaded')
  }

  const { img, previewUrl } = await normalizeImageFile(file)

  const detection = await faceapi
    .detectSingleFace(
      img,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,
        scoreThreshold: 0.35,
      })
    )
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!detection) {
    throw new Error('No face found in the photo. Try a clearer face photo')
  }

  return {
    descriptor: Array.from(detection.descriptor),
    previewUrl,
  }
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
      const result = await extractDescriptor(file)

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