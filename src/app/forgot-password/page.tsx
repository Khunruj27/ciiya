'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'

export default function ForgotPasswordPage() {
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    const redirectTo = `${window.location.origin}/reset-password`

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    })

    setLoading(false)

    if (error) {
      setErrorMsg(error.message)
      return
    }

    setSuccessMsg('Password reset email sent. Please check your inbox.')
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto max-w-md pt-16">
        <h1 className="text-4xl font-bold text-slate-900">Forgot password</h1>
        <p className="mt-3 text-slate-500">
          Enter your email and we will send you a reset link.
        </p>

        <form onSubmit={handleReset} className="mt-10 space-y-5">
          <div>
            <label className="mb-2 block text-sm text-slate-500">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-2xl bg-slate-100 px-4 py-4 outline-none"
            />
          </div>

          {errorMsg ? (
            <p className="text-sm text-red-500">{errorMsg}</p>
          ) : null}

          {successMsg ? (
            <p className="text-sm text-green-600">{successMsg}</p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-blue-600 px-4 py-4 text-white disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link href="/login" className="text-blue-600 hover:text-blue-700">
            Back to login
          </Link>
        </p>
      </div>
    </main>
  )
}