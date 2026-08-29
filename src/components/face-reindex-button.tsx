'use client'

import { useState } from 'react'

type Photo = {
  id: string
  public_url: string
  preview_url?: string | null
  thumbnail_url?: string | null
  filename?: string | null
  blur_data_url?: string | null
}

type Props = {
  albumId: string
  photos: Photo[]
}

type FaceDetectionResult = {
  detection: {
    box: {
      x: number
      y: number
      width: number
      height: number
    }
    score: number
  }
  descriptor: Float32Array | number[]
}

let modelsLoaded = false

async function loadFaceModels() {
  if (typeof window === 'undefined') {
    throw new Error('Face API must run on client')
  }

  const faceapi = await import('@vladmandic/face-api')

  if (modelsLoaded) return faceapi

  // SSD MobileNet v1 finds the small, partly-occluded faces in group shots
  // that the tiny detector misses — which is exactly where gallery indexing
  // needs the recall. It is slower per photo, but re-indexing is a deliberate
  // one-off, so the accuracy is worth the extra time.
  await faceapi.nets.ssdMobilenetv1.loadFromUri('/models')
  await faceapi.nets.faceLandmark68Net.loadFromUri('/models')
  await faceapi.nets.faceRecognitionNet.loadFromUri('/models')

  modelsLoaded = true
  return faceapi
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = src
  })
}

export default function FaceReindexButton({ albumId, photos }: Props) {
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [facesFound, setFacesFound] = useState(0)

  async function handleScan() {
    if (running) return

    setRunning(true)
    setDone(0)
    setFacesFound(0)

    try {
      const faceapi = await loadFaceModels()

      for (let i = 0; i < photos.length; i += 1) {
        const photo = photos[i]
        const imageUrl = photo.preview_url || photo.public_url

        if (!imageUrl) {
          setDone(i + 1)
          continue
        }

        try {
          const img = await loadImage(imageUrl)

          const detections = await faceapi
            .detectAllFaces(
              img,
              new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
            )
            .withFaceLandmarks()
            .withFaceDescriptors()

          const faces = detections.map((result: FaceDetectionResult) => {
            const box = result.detection.box

            return {
              embedding: Array.from(result.descriptor),
              box: {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
              },
              confidence: result.detection.score,
            }
          })

          const res = await fetch('/api/faces/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              albumId,
              photoId: photo.id,
              faces,
            }),
          })

          if (!res.ok) {
            const text = await res.text()
            console.error('Save faces failed:', text)
          }

          setFacesFound((value) => value + faces.length)
        } catch (error) {
          console.error('Scan photo failed:', error)
        }

        setDone(i + 1)
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleScan}
        disabled={running || photos.length === 0}
        className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
      >
        {running ? `Scanning ${done}/${photos.length}` : 'Scan Faces'}
      </button>

      {running ? (
        <p className="text-[11px] text-muted">
          Found {facesFound} faces
        </p>
      ) : null}
    </div>
  )
}