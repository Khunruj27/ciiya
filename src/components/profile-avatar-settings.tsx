'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'

type Props = {
  email?: string | null
  initialAvatarUrl?: string | null
}

export default function ProfileAvatarSettings({
  email,
  initialAvatarUrl,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl || '')
  const [uploading, setUploading] = useState(false)

  const initial = email?.[0]?.toUpperCase() || 'U'

  async function handleFile(file: File) {
    try {
      setUploading(true)

      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        alert(data?.error || 'Upload failed')
        return
      }

      setAvatarUrl(data.avatarUrl)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-sm font-bold text-slate-700 ring-1 ring-black/5"
        title="Change profile photo"
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt="Profile"
            fill
            sizes="48px"
            className="object-cover"
          />
        ) : (
          initial
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />
    </div>
  )
}