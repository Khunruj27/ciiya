'use client'

import { useEffect, useState } from 'react'
import AppIcon from '@/components/app-icon'

type Props = {
  albumId: string
}

export default function DeleteAlbumButton({ albumId }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!deleting) {
      setProgress(0)
      return
    }

    let current = 0

    const interval = setInterval(() => {
      current += Math.random() * 8

      // วิ่งช้าลงเมื่อใกล้เต็ม
      if (current >= 92) {
        current = 92
      }

      setProgress(Math.floor(current))
    }, 180)

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

      // จบสวย ๆ
      setProgress(100)

      setTimeout(() => {
        window.location.href = '/albums'
      }, 450)
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
          <div className="w-full max-w-[420px] rounded-[34px] bg-white p-8 text-center shadow-2xl">
            {/* Spinner */}
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-slate-200">
              <div className="h-16 w-16 animate-spin rounded-full border-4 border-transparent border-t-[#2F6BFF]" />
            </div>

            <h2 className="mt-6 text-[34px] font-bold tracking-tight text-slate-950">
              Deleting album
            </h2>

            <p className="mt-3 text-[17px] leading-8 text-slate-500">
              Removing photos, storage files, and album data...
            </p>

            {/* Progress */}
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between text-sm font-medium text-slate-500">
                <span>Processing</span>
                <span>{progress}%</span>
              </div>

              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[#2F6BFF] transition-all duration-300 ease-out"
                  style={{
                    width: `${progress}%`,
                  }}
                />
              </div>
            </div>

            <p className="mt-5 text-sm text-slate-400">
              Please wait, do not close this page.
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}