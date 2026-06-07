'use client'

import { useMemo, useState } from 'react'

type QueueItem = {
  id: string
  filename: string
  type: 'upload' | 'photo' | 'face'
  status: string
  progress: number
  created_at: string
}

type Props = {
  items: QueueItem[]
}

function getLabel(item: QueueItem) {
  const status = String(item.status || '').toLowerCase()

  if (item.type === 'upload') {
    if (status === 'pending') return 'Waiting'
    if (status === 'imported') return 'Importing'
    if (status === 'uploading') return 'Uploading'
    if (status === 'finalizing') return 'Finalizing'
    return 'Upload'
  }

  if (item.type === 'face') {
    if (status === 'pending') return 'Face Queued'
    if (status === 'processing') return 'Face Scan'
    return 'Face'
  }

  if (status === 'pending') return 'Queued'
  if (status === 'processing') return 'Processing'

  return 'Processing'
}

function getProgress(item: QueueItem) {
  const progress = Number(item.progress || 0)
  const status = String(item.status || '').toLowerCase()

  if (progress > 0) return Math.min(100, progress)

  if (status === 'pending') return 5
  if (status === 'imported') return 45
  if (status === 'uploading') return 72
  if (status === 'finalizing') return 88
  if (status === 'processing') return item.type === 'face' ? 55 : 45

  return 8
}

export default function AlbumProcessingQueue({ items }: Props) {
  const [open, setOpen] = useState(false)

  const activeItems = useMemo(() => {
    return items
      .filter((item) =>
        ['pending', 'imported', 'uploading', 'finalizing', 'processing'].includes(
  String(item.status || '').toLowerCase()
)
      )
      .slice(0, 5)
  }, [items])

  if (activeItems.length === 0) return null

  const uploadCount = activeItems.filter((item) => item.type === 'upload').length
  const processingCount = activeItems.filter((item) => item.type === 'photo').length
  const faceCount = activeItems.filter((item) => item.type === 'face').length

  return (
  <section className="pt-3">
    <div className="rounded-[22px] border border-black/5 bg-white px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F0B1DE]">
            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#1C0617]" />
          </div>

          <div className="min-w-0">
            <p className="truncate text-[13px] font-black tracking-[-0.03em] text-[#1C0617]">
              Processing {activeItems.length} photo
              {activeItems.length > 1 ? 's' : ''}
            </p>

            <p className="mt-0.5 truncate text-[10.5px] font-semibold text-[#8E8E93]">
              {uploadCount > 0 ? `Upload ${uploadCount}` : null}
              {uploadCount > 0 && processingCount > 0 ? ' • ' : null}
              {processingCount > 0 ? `Photo ${processingCount}` : null}
              {(uploadCount > 0 || processingCount > 0) && faceCount > 0
                ? ' • '
                : null}
              {faceCount > 0 ? `Face ${faceCount}` : null}
            </p>
          </div>
        </div>

        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FAF7F4] text-[16px] font-black text-[#8E8E93]">
          {open ? '−' : '+'}
        </span>
      </button>

      {open ? (
        <div className="mt-2.5 space-y-1.5">
          {activeItems.map((item) => {
            const progress = getProgress(item)

            return (
              <div
                key={`${item.type}-${item.id}`}
                className="rounded-[16px] bg-[#FAF7F4] px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-[11.5px] font-black text-[#1C0617]">
                    {item.filename || 'Photo'}
                  </p>

                  <p className="shrink-0 text-[10.5px] font-black text-[#8E8E93]">
                    {getLabel(item)} {progress}%
                  </p>
                </div>

                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/5">
                  <div
                    className="h-full rounded-full bg-[#F0B1DE]"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  </section>
)
}