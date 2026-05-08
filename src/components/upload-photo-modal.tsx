'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import UploadPhotoForm from '@/components/upload-photo-form'
import IconButton from '@/components/icon-button'
import AppIcon from '@/components/app-icon'

type Category = {
  id: string
  name: string
}

type Props = {
  albumId: string
  categories?: Category[]
}

export default function UploadPhotoModal({ albumId, categories = [] }: Props) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const modal =
    mounted && open
      ? createPortal(
          <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-8 backdrop-blur-sm sm:items-center sm:pb-8">
            <div className="relative flex max-h-[88vh] w-full max-w-[430px] flex-col rounded-[32px] bg-white p-5 shadow-2xl">
              <div className="mb-4 flex shrink-0 items-center justify-between">
                <h2 className="text-xl font-bold text-slate-950">
                  Upload Photos
                </h2>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-500 shadow-sm transition active:scale-95"
                  aria-label="Close upload modal"
                >
                  ×
                </button>
              </div>

              <div className="min-h-0 overflow-y-auto pr-1">
                <UploadPhotoForm albumId={albumId} categories={categories} />
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[48px] min-w-[170px] items-center justify-center gap-2 rounded-[20px] bg-[#2F6BFF] px-10 text-[16px] font-semibold text-white shadow-md transition active:scale-95"
      >
        Upload 
      </button>

      {modal}
    </>
  )
}