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

            <div className="relative z-10 w-full max-w-[390px] rounded-[32px] bg-white p-4 shadow-[0_30px_100px_rgba(15,23,42,0.35)]">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="mt-2 text-[34px] font-black tracking-[-0.06em] text-black">
                    Create Album
                  </h2>

                  <p className="mt-2 text-[15px] text-[#8E8E93]">
                    Create a new photo collection
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F2F3F7] text-[22px] font-bold text-black transition active:scale-[0.95]"
                  aria-label="Close create album modal"
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
        className="flex h-full w-full items-center justify-center gap-1.5 rounded-[22px] text-center text-white transition active:scale-[0.98]"
      >
        <Image
  src="/icons/square-plus1.svg"
  alt=""
  width={22}
  height={22}
  className="translate-y-[1px] object-contain"
/>

        <span className="text-[15px] text-black font-semibold leading-none tracking-[-0.02em]">
          New Album
        </span>
      </button>

      {modal}
    </>
  )
}