'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import IconButton from '@/components/icon-button'
import { useI18n } from '@/components/i18n-provider'

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
  const { t } = useI18n()
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
      setErrorMsg(t.albumSettings.titleRequired)
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
        throw new Error(data?.error || t.editAlbum.updateFailed)
      }

      setOpen(false)

      router.refresh()
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? error.message
          : t.editAlbum.updateFailed
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
          title={t.editAlbum.editHeading}
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
          className="flex h-11 items-center justify-center rounded-full bg-ink px-5 text-sm font-semibold tracking-[-0.02em] text-white shadow-[0_10px_30px_rgba(15,23,42,0.18)] transition active:scale-[0.98]"
        >
          {t.editAlbum.editHeading}
        </button>
      )}

      {open ? (
       <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 backdrop-blur-md px-5 pt-[max(60px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))] sm:items-center">
          <button
            type="button"
            aria-label={t.editAlbum.closeBackdrop}
            onClick={() => {
  if (!loading) setOpen(false)
}}
            className="absolute inset-0"
          />

         <div className="relative z-10 w-full max-w-[390px] max-h-[calc(100dvh-120px)] overflow-hidden rounded-hero bg-white shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
            {/* HEADER */}
            <div className="flex items-start justify-between px-5 pb-3 pt-4">
              <div>
               

                <h2 className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.05em]">
                  {t.editAlbum.editHeading}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => {
  if (!loading) setOpen(false)
}}
disabled={loading}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-ground-sunken text-[22px] font-semibold text-black transition active:scale-95"
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
                <label className="mb-2 block text-sm font-bold text-ink-soft">
                  {t.albumSettings.nameLabel}
                </label>

                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
  setTitle(e.target.value)
  setErrorMsg('')
}}
                  placeholder={t.albumSettings.namePlaceholder}
                  className="min-h-[110px] w-full resize-none rounded-panel border border-line bg-ground-sunken px-4 py-3 text-[15px] font-medium outline-none transition focus:border-gold focus:bg-surface"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-ink-soft">
                  {t.albumSettings.descLabel}
                </label>

                <textarea
                  value={description}
                  onChange={(e) => {
  setDescription(e.target.value)
  setErrorMsg('')
}}
                  placeholder={t.albumSettings.descPlaceholder}
                  className="
min-h-[110px]
w-full
resize-none
rounded-panel
border border-line
bg-ground-sunken
px-4
py-3
text-[15px]
font-medium
outline-none
transition focus:border-gold focus:bg-surface"
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
                className="flex h-[52px] w-full items-center justify-center rounded-card bg-gold text-[15px] font-semibold text-white border border-line transition active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? t.albumSettings.saving : t.editAlbum.saveChanges}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
