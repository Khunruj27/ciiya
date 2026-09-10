'use client'

import { useState } from 'react'
import NextImage from 'next/image'
import { ScanFace } from 'lucide-react'
import {
  extractSelfieDescriptor,
  SelfieQualityError,
  type FaceDescriptorStage,
} from '@/lib/face-descriptor'
import { useI18n } from '@/components/i18n-provider'

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

export default function SelfieFaceSearch({
  albumId,
  token,
  variant = 'floating',
}: {
  albumId: string
  token: string
  /*
   * 'inline' places the trigger in normal page flow. 'floating' pins it
   * above the bottom-right corner, clear of the centred selection bar and
   * the bottom-left back-to-top button.
   */
  variant?: 'floating' | 'inline'
}) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
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
      setProgress(4)
      setMessage(t.faceSearch.loadingEngine)
      setResults([])
      setSelectedIds(new Set())

      const stageMessage = (stage: FaceDescriptorStage) => {
        switch (stage) {
          case 'engine':
            return t.faceSearch.loadingEngine
          case 'detector':
            return t.faceSearch.loadingDetector
          case 'landmarks':
            return t.faceSearch.loadingLandmarks
          case 'recognition':
            return t.faceSearch.loadingRecognition
          case 'analyzing':
            return t.faceSearch.analyzingSelfie
        }
      }

      const { descriptor } = await extractSelfieDescriptor(
        file,
        ({ progress: nextProgress, stage }) => {
          setProgress(nextProgress)
          setMessage(stageMessage(stage))
        }
      )

      setProgress(96)
      setMessage(t.faceSearch.searching)

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
        throw new Error(searchData?.error || t.faceSearch.searchFailed)
      }

      setResults(searchData.results || [])
      setProgress(100)
      setMessage(t.faceSearch.foundCount(searchData.count || 0))
    } catch (error) {
      if (error instanceof SelfieQualityError) {
        setMessage(
          error.reason === 'no-face'
            ? t.faceSearch.noFace
            : t.faceSearch.unclearFace
        )
      } else {
        setMessage(t.faceSearch.errorGeneric)
      }
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
        aria-label={t.common.findMyPhotos}
        className={
          variant === 'inline'
            ? 'ml-auto flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[12px] font-bold text-white transition active:scale-95 disabled:opacity-60'
            : 'group fixed bottom-[calc(1.25rem+15vh)] right-4 z-50 flex h-16 w-16 items-center justify-center rounded-full border border-line bg-surface/90 text-ink shadow-lift backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:text-gold-deep hover:shadow-float active:scale-95 disabled:opacity-60'
        }
      >
        <ScanFace
          aria-hidden="true"
          strokeWidth={1.4}
          className={variant === 'inline' ? 'h-4 w-4' : 'h-7 w-7'}
        />

        {variant === 'inline' ? <span>{t.common.findMyPhotos}</span> : null}
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
        <div className="fixed bottom-[calc(11rem+15vh)] right-4 z-50 max-w-[min(320px,calc(100vw-2rem))] rounded-panel border border-line bg-surface px-4 py-3 text-[13px] text-ink shadow-lift">
          {message}
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-5">
          <div
            className="w-full max-w-sm rounded-hero border border-line bg-surface px-6 py-6 text-left shadow-lift"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="text-[16px] font-semibold text-ink">
                {t.faceSearch.searchingTitle}
              </div>
              <div className="text-[13px] font-semibold tabular-nums text-gold-deep">
                {progress}%
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ground-sunken">
              <div
                role="progressbar"
                aria-label={t.faceSearch.searchingTitle}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                className="h-full rounded-full bg-gold transition-[width] duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 text-[13px] text-muted">
              {message || t.faceSearch.searchingDesc}
            </div>
            <div className="mt-4 rounded-control bg-ground px-3 py-3 text-[12px] leading-5 text-muted">
              {t.faceSearch.firstLoadNote}
            </div>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-6">
          <div className="mx-auto max-w-5xl rounded-hero bg-surface p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">{t.faceSearch.resultsTitle}</h2>
                <p className="text-sm text-muted">
                  {t.faceSearch.resultsSubtitle(results.length)}
                </p>
              </div>

              <button
                onClick={() => {
                  setResults([])
                  setMessage('')
                  setSelectedIds(new Set())
                }}
                className="min-h-11 rounded-full bg-ground-sunken px-4 py-2 text-sm"
              >
                {t.faceSearch.close}
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
                      alt={item.photo?.filename || t.faceSearch.matchedAlt}
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
                          ? 'border-gold bg-gold text-white'
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
            <div className="flex items-center gap-3 rounded-full bg-ink px-3 py-2 text-white shadow-[0_18px_50px_rgba(15,23,42,0.35)]">
              <p className="whitespace-nowrap px-1 text-sm font-semibold">
                {t.faceSearch.selectedCount(selectedIds.size, MAX_SELECTION)}
              </p>

              <button
                type="button"
                onClick={handleBatchDownload}
                disabled={selectedIds.size === 0 || batchDownloading}
                className="flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-gold px-4 py-2 text-sm font-bold text-ink transition-opacity disabled:opacity-40"
              >
                {batchDownloading ? t.faceSearch.downloading : t.faceSearch.download}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
