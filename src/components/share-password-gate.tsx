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
    <main className="min-h-screen bg-[#F5F5F7] px-4 py-10 text-black">
      <div className="mx-auto max-w-[430px] rounded-[36px] bg-white p-7 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <p className="text-[13px] font-semibold text-[#8E8E93]">
          Ciiya Gallery
        </p>

        <h1 className="mt-3 text-[26px] font-black tracking-[-0.05em]">
          {albumTitle || 'This album is protected'}
        </h1>

        <p className="mt-2 text-[14px] font-medium leading-6 text-[#8E8E93]">
          Enter the password from the photographer to view this gallery.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-[16px] border border-black/10 px-4 py-3 text-[15px] font-medium outline-none focus:border-black/30"
          />

          {errorMsg ? (
            <p className="text-[13px] font-semibold text-red-500">
              {errorMsg}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-[16px] bg-black py-3 text-[15px] font-bold text-white disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'View Gallery'}
          </button>
        </form>
      </div>
    </main>
  )
}
