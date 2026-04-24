'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    async function checkSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        setErrorMsg('Reset session not found or expired. Please request a new reset link.')
      }

      setChecking(false)
    }

    checkSession()
  }, [supabase])

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (!password || password.length < 6) {
      setErrorMsg('Password must be at least 6 characters')
      return
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({
      password,
    })

    setLoading(false)

    if (error) {
      setErrorMsg(error.message)
      return
    }

    setSuccessMsg('Password updated successfully. Redirecting to login...')

    window.setTimeout(() => {
      router.push('/login')
      router.refresh()
    }, 1200)
  }

  if (checking) {
    return (
      <main className="min-h-screen bg-white px-6 py-10">
        <div className="mx-auto max-w-md pt-16">
          <h1 className="text-4xl font-bold text-slate-900">Reset password</h1>
          <p className="mt-3 text-slate-500">Checking reset session...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto max-w-md pt-16">
        <h1 className="text-4xl font-bold text-slate-900">Reset password</h1>
        <p className="mt-3 text-slate-500">
          Enter your new password below.
        </p>

        <form onSubmit={handleUpdatePassword} className="mt-10 space-y-5">
          <div>
            <label className="mb-2 block text-sm text-slate-500">
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-2xl bg-slate-100 px-4 py-4 outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-500">
              Confirm password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
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
            disabled={loading || !!errorMsg}
            className="w-full rounded-2xl bg-blue-600 px-4 py-4 text-white disabled:opacity-50"
          >
            {loading ? 'Updating...' : 'Update password'}
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