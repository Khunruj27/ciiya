'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CreateAlbumForm() {
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const res = await fetch('/api/albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    })

    const data = await res.json()

    setLoading(false)

    if (!res.ok) {
      setErrorMsg(data.error || 'Something went wrong')
      return
    }

    setTitle('')
    setDescription('')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Create Album</h2>

      <div className="mt-4 space-y-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Album title"
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none"
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Album description"
          className="min-h-[100px] w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none"
        />

        {errorMsg ? <p className="text-sm text-red-500">{errorMsg}</p> : null}

        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-white disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Album'}
        </button>
      </div>
    </form>
  )
}