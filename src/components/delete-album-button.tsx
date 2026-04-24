'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  albumId: string
}

export default function DeleteAlbumButton({ albumId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    const confirmed = window.confirm(
      'Delete this album and all photos inside it?'
    )

    if (!confirmed) return

    setLoading(true)

    const res = await fetch('/api/albums/delete', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ albumId }),
    })

    setLoading(false)

    if (!res.ok) {
      const text = await res.text()
      alert(text || 'Failed to delete album')
      return
    }

    router.push('/albums')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="rounded-full bg-red-500 px-4 py-2 text-sm text-white disabled:opacity-50"
    >
      {loading ? 'Deleting...' : 'Delete Album'}
    </button>
  )
}