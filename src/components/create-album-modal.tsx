'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import CreateAlbumForm from '@/components/create-album-form'
import Image from 'next/image'

export default function CreateAlbumModal() {
  const [open, setOpen] = useState(false)

  const mounted = useSyncExternalStore(
  () => () => {},
  () => true,
  () => false
)

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const modal =
    open && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/45 px-5 backdrop-blur-sm">
            <div
             role="presentation"
             onClick={() => setOpen(false)}
             className="absolute inset-0"
            />

            <div className="relative z-10 w-full max-w-lg rounded-panel border border-line bg-surface p-5 shadow-float sm:p-7">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-ink">
                    สร้างงานใหม่
                  </h2>

                  <p className="mt-2 text-[15px] text-muted">
                    ตั้งชื่องานแล้วเริ่มอัปโหลดภาพได้ทันที
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-ground-sunken text-[22px] font-bold text-black transition active:scale-[0.95]"
                  aria-label="ปิดหน้าต่างสร้างงาน"
                >
                  ✕
                </button>
              </div>

              <CreateAlbumForm onSuccess={() => setOpen(false)} />
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
        className="flex h-full w-full items-center justify-center gap-1.5 rounded-panel text-center text-white transition active:scale-[0.98]"
      >
        <Image
  src="/icons/square-plus1.svg"
  alt=""
  width={22}
  height={22}
  className="translate-y-[1px] object-contain"
/>

        <span className="text-[15px] text-black font-semibold leading-none tracking-[-0.02em]">
          สร้างงานใหม่
        </span>
      </button>

      {modal}
    </>
  )
}
