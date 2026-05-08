'use client'

import { useState } from 'react'

type SearchResult = {
  faceId: string
  photoId: string
  score: number
  confidence: number
  photo: {
    id: string
    filename: string | null
    public_url: string | null
    preview_url: string | null
    thumbnail_url: string | null
  } | null
}

let modelsLoaded = false

async function loadFaceApi() {
  const faceapi = await import('@vladmandic/face-api')

  if (!modelsLoaded) {
    await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
    await faceapi.nets.faceLandmark68Net.loadFromUri('/models')
    await faceapi.nets.faceRecognitionNet.loadFromUri('/models')

    modelsLoaded = true
  }

  return faceapi
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('โหลดรูปไม่สำเร็จ'))
    }

    img.src = url
  })
}

export default function SelfieFaceSearch({ albumId }: { albumId: string }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])

  async function handleFile(file: File) {
    try {
      setLoading(true)
      setMessage('กำลังสแกนใบหน้า...')
      setResults([])

      const faceapi = await loadFaceApi()
      const img = await loadImageFromFile(file)

      const detections = await faceapi
        .detectAllFaces(
          img,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 512,
            scoreThreshold: 0.45,
          })
        )
        .withFaceLandmarks()
        .withFaceDescriptors()

      if (!detections.length) {
        throw new Error('ไม่พบใบหน้าในรูปเซลฟี่')
      }

      const descriptor = Array.from(detections[0].descriptor)

      setMessage('กำลังค้นหารูปที่ตรงกัน...')

      const searchRes = await fetch('/api/faces/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          albumId,
          descriptor,
        }),
      })

      const searchData = await searchRes.json()

      if (!searchRes.ok || !searchData.success) {
        throw new Error(searchData?.error || 'ค้นหาไม่สำเร็จ')
      }

      setResults(searchData.results || [])
      setMessage(`พบรูปที่ตรงกัน ${searchData.count || 0} รูป`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          const input = document.getElementById(
            'selfie-upload-input'
          ) as HTMLInputElement | null

          input?.click()
        }}
        disabled={loading}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white shadow-2xl transition hover:scale-105 disabled:opacity-60"
      >
        🔍 Face Search
      </button>

      <input
        id="selfie-upload-input"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      {message && !loading && results.length === 0 && (
        <div className="fixed bottom-24 right-6 z-50 max-w-[320px] rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-xl">
          {message}
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
          <div className="rounded-3xl bg-white px-8 py-6 text-center shadow-2xl">
            <div className="mb-3 text-lg font-bold">กำลังค้นหารูป...</div>
            <div className="text-sm text-slate-500">
              ระบบ AI กำลังเปรียบเทียบใบหน้า
            </div>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-6">
          <div className="mx-auto max-w-5xl rounded-[32px] bg-white p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">ผลการค้นหา</h2>
                <p className="text-sm text-slate-500">
                  พบ {results.length} รูป
                </p>
              </div>

              <button
                onClick={() => {
                  setResults([])
                  setMessage('')
                }}
                className="rounded-full bg-slate-100 px-4 py-2 text-sm"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {results.map((item) => {
                const imageUrl =
                  item.photo?.preview_url ||
                  item.photo?.thumbnail_url ||
                  item.photo?.public_url

                if (!imageUrl) return null

                return (
                  <a
                    key={item.faceId}
                    href={item.photo?.public_url || imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="relative overflow-hidden rounded-2xl"
                  >
                    <img
                      src={imageUrl}
                      alt={item.photo?.filename || 'Matched photo'}
                      className="aspect-square w-full object-cover"
                    />

                    <div className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-xs text-white">
                      {item.confidence}%
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}