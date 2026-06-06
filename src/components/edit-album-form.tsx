'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import IconButton from '@/components/icon-button'

type Props = {
  albumId: string
  initialTitle: string
  initialDescription: string | null
  iconOnly?: boolean
}

export default function EditAlbumForm({
  albumId,
  initialTitle,
  initialDescription,
  iconOnly = false,
}: Props) {
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(
    initialDescription || ''
  )

  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    setErrorMsg('')

    if (!title.trim()) {
      setErrorMsg('Title is required')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/albums/update', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          albumId,
          title: title.trim(),
          description: description.trim(),
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update album')
      }

      setOpen(false)

      router.refresh()
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Failed to update album'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {iconOnly ? (
        <IconButton
          icon="pen"
          title="Edit Album"
          onClick={() => setOpen(true)}
          variant="ghost"
          size="sm"
          className="rounded-full"
          iconClassName="w-5 h-5 opacity-80"
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold tracking-[-0.02em] text-white shadow-[0_10px_30px_rgba(15,23,42,0.18)] transition active:scale-[0.98]"
        >
          Edit Album
        </button>
      )}

      {open ? (
       <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 backdrop-blur-md px-5 pt-[max(60px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))] sm:items-center">
          <button
            type="button"
            aria-label="Close edit modal backdrop"
            onClick={() => {
  if (!loading) setOpen(false)
}}
            className="absolute inset-0"
          />

         <div className="relative z-10 w-full max-w-[390px] max-h-[calc(100dvh-120px)] overflow-hidden rounded-[30px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
            {/* HEADER */}
            <div className="flex items-start justify-between px-5 pb-3 pt-4">
              <div>
               

                <h2 className="mt-2 text-[28px] font-black leading-none tracking-[-0.05em]">
                  Edit
                </h2>
              </div>

              <button
                type="button"
                onClick={() => {
  if (!loading) setOpen(false)
}}
disabled={loading}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F6F7FA] text-[22px] font-black text-black transition active:scale-95"
              >
                ×
              </button>
            </div>

            {/* FORM */}
            <form
              onSubmit={handleSubmit}
             className="space-y-4 overflow-y-auto px-5 pt-4 pb-[max(24px,env(safe-area-inset-bottom))]"
            >
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">
                  Album Title
                </label>

                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
  setTitle(e.target.value)
  setErrorMsg('')
}}
                  placeholder="Album title"
                  className="min-h-[110px] w-full resize-none rounded-[20px] border border-slate-200 bg-[#F8F9FC] px-4 py-3 text-[15px] font-medium outline-none transition focus:border-[#0257ff] focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">
                  Description
                </label>

                <textarea
                  value={description}
                  onChange={(e) => {
  setDescription(e.target.value)
  setErrorMsg('')
}}
                  placeholder="Album description"
                  className="
min-h-[110px]
w-full
resize-none
rounded-[20px]
border border-slate-200
bg-[#F8F9FC]
px-4
py-3
text-[15px]
font-medium
outline-none
transition focus:border-[#0257ff] focus:bg-white"
                />
              </div>

              {errorMsg ? (
                <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                  {errorMsg}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="flex h-[52px] w-full items-center justify-center rounded-[18px] bg-[#F0B1DE] text-[15px] font-black text-white border border-black/5 transition active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}