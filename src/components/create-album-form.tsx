'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Props = {
  onSuccess?: () => void
}

type UploadMode = 'manual' | 'auto'
type UploadSize = 'sd' | 'hd' | 'uhd' | 'original'
type UploadProfile = 'quick' | 'standard' | 'professional' | 'original'

export default function CreateAlbumForm({ onSuccess }: Props) {
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [uploadMode, setUploadMode] = useState<UploadMode>('manual')
  const [uploadSize, setUploadSize] = useState<UploadSize>('uhd')
  const [uploadProfile, setUploadProfile] = useState<UploadProfile>('professional')
  const [autoPublish, setAutoPublish] = useState(true)
  const [autoFaceScan, setAutoFaceScan] = useState(true)
  const [albumPresetPath, setAlbumPresetPath] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    setError('')

    if (!title.trim()) {
      setError('กรุณาใส่ชื่องาน')
      return
    }

    try {
      setLoading(true)

      const res = await fetch('/api/albums/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          uploadMode,
          uploadSize,
          uploadProfile,
          autoPublish,
          autoFaceScan,
          albumPresetPath,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error || 'สร้างงานไม่สำเร็จ')
        return
      }

      setTitle('')
      setDescription('')
      setUploadMode('manual')
      setUploadSize('uhd')
      setUploadProfile('professional')
      setAutoPublish(true)
      setAutoFaceScan(true)
      setAlbumPresetPath('')

      router.refresh()
      onSuccess?.()
    } catch {
      setError('สร้างงานไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 pt-3 text-ink">
      <div className="space-y-3">
        <input
          type="text"
          placeholder="ชื่องาน"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={loading}
          className="w-full rounded-control border border-line bg-ground px-4 py-3 text-[15px] font-medium outline-none transition focus:border-gold"
        />

        <textarea
          placeholder="คำอธิบายงาน (ไม่บังคับ)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
          className="min-h-[96px] w-full resize-none rounded-control border border-line bg-ground px-4 py-3 text-[15px] font-medium outline-none transition focus:border-gold"
        />
      </div>

      <button
        type="button"
        onClick={handleCreate}
        disabled={loading}
        className="flex h-13 min-h-13 w-full items-center justify-center rounded-control bg-ink px-5 text-[15px] font-medium text-white transition hover:bg-ink-soft disabled:opacity-50"
      >
        {loading ? 'กำลังสร้างงาน…' : 'สร้างงาน'}
      </button>
      {error ? (
  <p className="px-2 text-sm font-semibold text-red-500">
    {error}
  </p>
) : null}
    </div>
  )
}
