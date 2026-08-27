'use client'

import { useEffect, useState } from 'react'
import AppIcon from '@/components/app-icon'
import { useRouter } from 'next/navigation'

type Props = {
  albumId: string
}

export default function DeleteAlbumButton({ albumId }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [progress, setProgress] = useState(0)
  const router = useRouter()

  useEffect(() => {
  if (!deleting) return

  let current = 8

  const interval = setInterval(() => {
    current += (92 - current) * 0.08

    if (current > 92) {
      current = 92
    }

    setProgress(Math.round(current))
  }, 120)

  return () => clearInterval(interval)
}, [deleting])

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (deleting) return

    const ok = confirm(
      'Delete this album?\n\nThis will remove photos and storage files too.'
    )

    if (!ok) return

    try {
      setDeleting(true)
      setProgress(8)

      const res = await fetch('/api/albums/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          albumId,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        alert(data?.error || 'Delete failed')
        setDeleting(false)
        return
      }

      // A beautiful finish
      setProgress(100)

setTimeout(() => {
  router.refresh()
}, 250)

setTimeout(() => {
  setDeleting(false)
}, 400)
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : 'Delete failed'
      )

      setDeleting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="absolute right-3 top-3 z-10 !bg-transparent !shadow-none !ring-0 p-0"
        title="Delete album"
      >
        {deleting ? (
          <span className="text-sm text-red-500">…</span>
        ) : (
          <AppIcon
            name="delete"
            size={18}
            className="opacity-80"
          />
        )}
      </button>

      {deleting ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 px-5 backdrop-blur-sm">
          <div className="w-full max-w-[380px] rounded-[30px] bg-white p-6 text-center shadow-2xl">
            {/* Spinner */}
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-4 border-line">
             <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#DCE6FF] border-t-[#0257ff]" />
            </div>

            <h2 className="mt-6 text-[28px] sm:text-[32px] font-bold tracking-tight text-ink">
              Deleting album
            </h2>

            <p className="mt-3 text-[15px] leading-7 leading-8 text-muted">
              Removing photos, storage files, and album data...
            </p>

            {/* Progress */}
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between text-sm font-medium text-muted">
                <span>Processing</span>
                <span>{progress}%</span>
              </div>

              <div className="h-2.5 w-full overflow-hidden rounded-full bg-ground-sunken">
                <div className="h-full rounded-full bg-[#0257ff] transition-[width] duration-500 ease-out"
                  style={{
                    width: `${progress}%`,
                  }}
                />
              </div>
            </div>

            <p className="mt-5 text-sm text-muted">
              Please wait, do not close this page.
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}