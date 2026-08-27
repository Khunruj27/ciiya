'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  token: string
  albumTitle: string | null
}

export default function SharePasswordGate({ token, albumTitle }: Props) {
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg('')

    if (!password) {
      setErrorMsg('Please enter the password')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/share/verify-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Incorrect password')
      }

      router.refresh()
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : 'Incorrect password'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-ground px-4 py-10 text-black">
      <div className="mx-auto max-w-[430px] rounded-hero border border-line bg-surface p-7 shadow-lift">
        <p className="text-[13px] font-semibold text-muted">
          Ciiya Gallery
        </p>

        <h1 className="mt-3 text-[26px] font-semibold tracking-[-0.05em]">
          {albumTitle || 'This album is protected'}
        </h1>

        <p className="mt-2 text-[14px] font-medium leading-6 text-muted">
          Enter the password from the job owner to view the gallery
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-control border border-line px-4 py-3 text-[15px] font-medium outline-none focus:border-gold"
          />

          {errorMsg ? (
            <p className="text-[13px] font-semibold text-red-500">
              {errorMsg}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-control bg-ink py-3 text-[15px] font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Open gallery'}
          </button>
        </form>
      </div>
    </main>
  )
}
