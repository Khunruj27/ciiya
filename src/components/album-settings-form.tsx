'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  albumId: string
  initialTitle: string
  initialDescription: string | null
  initialAllowDownload: boolean
  initialIsPasswordProtected: boolean
}

export default function AlbumSettingsForm({
  albumId,
  initialTitle,
  initialDescription,
  initialAllowDownload,
  initialIsPasswordProtected,
}: Props) {
  const router = useRouter()

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription || '')
  const [allowDownload, setAllowDownload] = useState(initialAllowDownload)
  const [isPasswordProtected, setIsPasswordProtected] = useState(
    initialIsPasswordProtected
  )
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (!title.trim()) {
      setErrorMsg('Title is required')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/albums/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          albumId,
          title: title.trim(),
          description: description.trim(),
          allowDownload,
          isPasswordProtected,
          password,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save settings')
      }

      setSuccessMsg('Album settings updated successfully')
      setPassword('')
      router.refresh()
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : 'Failed to save settings'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Album Settings</h2>
        <p className="text-sm text-slate-500">
          Manage basic info, privacy, and download options
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-500">Album title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none"
          placeholder="Album title"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-500">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[110px] w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none"
          placeholder="Album description"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 p-4">
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900">
              Allow downloads
            </p>
            <p className="text-xs text-slate-500">
              Let public visitors download photos
            </p>
          </div>

          <input
            type="checkbox"
            checked={allowDownload}
            onChange={(e) => setAllowDownload(e.target.checked)}
            className="h-5 w-5"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900">
              Password protection
            </p>
            <p className="text-xs text-slate-500">
              Require password before viewing this album
            </p>
          </div>

          <input
            type="checkbox"
            checked={isPasswordProtected}
            onChange={(e) => setIsPasswordProtected(e.target.checked)}
            className="h-5 w-5"
          />
        </label>

        {isPasswordProtected ? (
          <div>
            <label className="mb-2 block text-sm text-slate-500">
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none"
              placeholder="Leave blank to keep current password"
            />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            history.back()
          }}
          className="rounded-2xl bg-slate-100 px-4 py-3 text-center text-slate-700"
        >
          Back
        </a>

        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl bg-blue-600 px-4 py-3 text-white disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {errorMsg ? <p className="text-sm text-red-500">{errorMsg}</p> : null}
      {successMsg ? <p className="text-sm text-green-600">{successMsg}</p> : null}
    </form>
  )
}