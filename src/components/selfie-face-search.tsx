'use client'

import { useState } from 'react'
import NextImage from 'next/image'

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

const MAX_SELECTION = 10

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

export default function SelfieFaceSearch({
  albumId,
  token,
}: {
  albumId: string
  token: string
}) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDownloading, setBatchDownloading] = useState(false)

  function toggleSelect(photoId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)

      if (next.has(photoId)) {
        next.delete(photoId)
        return next
      }

      if (next.size >= MAX_SELECTION) return next

      next.add(photoId)
      return next
    })
  }

  function handleBatchDownload() {
    if (selectedIds.size === 0 || batchDownloading) return

    setBatchDownloading(true)

    const ids = Array.from(selectedIds)

    ids.forEach((photoId, index) => {
      window.setTimeout(() => {
        const link = document.createElement('a')
        link.href = `/api/photos/download?photoId=${encodeURIComponent(
          photoId
        )}&token=${encodeURIComponent(token)}`
        document.body.appendChild(link)
        link.click()
        link.remove()
      }, index * 400)
    })

    window.setTimeout(() => {
      setBatchDownloading(false)
      setSelectedIds(new Set())
    }, ids.length * 400)
  }

  async function handleFile(file: File) {
    try {
      setLoading(true)
      setMessage('กำลังสแกนใบหน้า...')
      setResults([])
      setSelectedIds(new Set())

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
  token,
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
        aria-label="ค้นหารูปด้วยใบหน้า"
        className="fixed right-4 top-1/2 z-50 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black text-white shadow-2xl transition hover:scale-105 disabled:opacity-60"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-7 w-7"
        >
          <path d="M4 8V6a2 2 0 0 1 2-2h2" />
          <path d="M16 4h2a2 2 0 0 1 2 2v2" />
          <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
          <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
          <circle cx="12" cy="11" r="3.2" />
          <path d="M9 16.2c.7-1 1.8-1.6 3-1.6s2.3.6 3 1.6" />
        </svg>
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
                  setSelectedIds(new Set())
                }}
                className="rounded-full bg-slate-100 px-4 py-2 text-sm"
              >
                ปิด
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pb-24 md:grid-cols-4">
              {results.map((item) => {
                const imageUrl =
                  item.photo?.preview_url ||
                  item.photo?.thumbnail_url ||
                  item.photo?.public_url

                if (!imageUrl) return null

                const isOriginalFallback =
                  !item.photo?.preview_url && !item.photo?.thumbnail_url

                const selected = selectedIds.has(item.photoId)

                return (
                  <button
                    type="button"
                    key={item.faceId}
                    onClick={() => toggleSelect(item.photoId)}
                    className="relative aspect-square overflow-hidden rounded-2xl text-left"
                  >
                    <NextImage
                      src={imageUrl}
                      alt={item.photo?.filename || 'Matched photo'}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      unoptimized={isOriginalFallback}
                      className="object-cover"
                    />

                    <div className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-xs text-white">
                      {item.confidence}%
                    </div>

                    <div
                      className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 backdrop-blur transition-colors ${
                        selected
                          ? 'border-[#F0B1DE] bg-[#F0B1DE] text-white'
                          : 'border-white/80 bg-black/20 text-transparent'
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="fixed inset-x-0 bottom-5 z-[95] flex justify-center px-4">
            <div className="flex items-center gap-3 rounded-full bg-slate-900 px-3 py-2 text-white shadow-[0_18px_50px_rgba(15,23,42,0.35)]">
              <p className="whitespace-nowrap px-1 text-sm font-semibold">
                เลือกแล้ว {selectedIds.size}/{MAX_SELECTION} รูป
              </p>

              <button
                type="button"
                onClick={handleBatchDownload}
                disabled={selectedIds.size === 0 || batchDownloading}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#F0B1DE] px-4 py-2 text-sm font-bold text-[#4A3140] transition-opacity disabled:opacity-40"
              >
                {batchDownloading ? 'กำลังดาวน์โหลด…' : '⬇ ดาวน์โหลด'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}