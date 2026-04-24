'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  photoId: string
}

export default function DeletePhotoButton({ photoId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    const confirmed = window.confirm('Delete this photo?')
    if (!confirmed) return

    setLoading(true)

    const res = await fetch('/api/photos/delete', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ photoId }),
    })

    setLoading(false)

    if (!res.ok) {
      const text = await res.text()
      alert(text || 'Failed to delete photo')
      return
    }

    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="rounded-full bg-red-500/90 px-3 py-1.5 text-xs text-white shadow disabled:opacity-50"
    >
      {loading ? 'Deleting...' : 'Delete'}
    </button>
  )
}