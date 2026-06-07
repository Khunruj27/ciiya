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
      setError('Please enter album title')
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
        setError(data?.error || 'Create album failed')
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
      setError('Create album failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 p-3 text-[#1C0617]">
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Album title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={loading}
          className="w-full rounded-[22px] border border-black/5 bg-[#FAF7F4] px-4 py-3 text-[15px] font-semibold outline-none"
        />

        <textarea
          placeholder="Album description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
          className="min-h-[92px] w-full resize-none rounded-[22px] border border-black/5 bg-[#FAF7F4] px-4 py-3 text-[15px] font-semibold outline-none"
        />
      </div>

      <button
        type="button"
        onClick={handleCreate}
        disabled={loading}
        className="flex h-13 min-h-13 w-full items-center justify-center rounded-full border border-black/5 bg-[#F0B1DE] px-5 text-[15px] font-black text-[#1C0617] disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Create Album'}
      </button>
      {error ? (
  <p className="px-2 text-sm font-semibold text-red-500">
    {error}
  </p>
) : null}
    </div>
  )
}