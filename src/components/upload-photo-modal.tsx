'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import UploadPhotoForm from '@/components/upload-photo-form'
import type { OptimisticUpload } from '@/components/optimistic-upload'


type Category = {
  id: string
  name: string
}

type Props = {
  albumId: string
  categories?: Category[]
  initialAutoFaceScan?: boolean
  initialAutoPublish?: boolean
  onOptimisticUploads?: (items: OptimisticUpload[]) => void
}

export default function UploadPhotoModal({
  albumId,
  categories = [],
  initialAutoFaceScan = true,
  initialAutoPublish = false,
  onOptimisticUploads,
}: Props) {

  const [open, setOpen] = useState(false)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)



  function openModal() {
  if (typeof document === 'undefined') return

  setPortalHost(document.body)
  setOpen(true)
}

  function closeModal() {
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeModal()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const modal =
    open && portalHost
      ? createPortal(
          <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 px-4 pt-[max(60px,env(safe-area-inset-top))] pb-[max(22px,calc(env(safe-area-inset-bottom)+18px))] backdrop-blur-md sm:items-center sm:pb-8">
            <button
              type="button"
              aria-label="ปิดหน้าต่างอัปโหลด"
              onClick={closeModal}
              className="absolute inset-0 cursor-default"
            />

            <div className="relative z-10 flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-[24px] border border-line bg-surface shadow-float">
              <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-5">
                <div>
                  <h2 className="mt-3 text-[30px] font-black leading-none tracking-[-0.05em] text-black">
                    อัปโหลดรูปภาพ
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-black/5 text-2xl font-black leading-none text-black"
                  aria-label="ปิดหน้าต่างอัปโหลด"
                >
                  ×
                </button>
              </div>


              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
             <UploadPhotoForm
                albumId={albumId}
                categories={categories}
                initialAutoFaceScan={initialAutoFaceScan}
                initialAutoPublish={initialAutoPublish}
                onUploadStarted={() => setOpen(false)}
                onOptimisticUploads={onOptimisticUploads}
              />
              </div>
            </div>
          </div>,
          portalHost
        )
      : null

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label="อัปโหลดรูปภาพ"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-gold transition active:scale-95 disabled:opacity-60"
        disabled={open}
      >
        <span className="text-[34px] font-light leading-none">+</span>
      </button>

      {modal}
    </>
  )
}
