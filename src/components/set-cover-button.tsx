'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  albumId: string
  photoId: string
  isCurrentCover?: boolean
}

export default function SetCoverButton({
  albumId,
  photoId,
  isCurrentCover = false,
}: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleSetCover() {
    setLoading(true)

    const res = await fetch('/api/albums/cover', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        albumId,
        photoId,
      }),
    })

    setLoading(false)

    if (!res.ok) {
      const text = await res.text()
      alert(text || 'Failed to set cover')
      return
    }

    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleSetCover}
      disabled={loading || isCurrentCover}
      className="rounded-full bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow disabled:opacity-50"
    >
      {isCurrentCover ? 'Cover' : loading ? 'Saving...' : 'Set Cover'}
    </button>
  )
}