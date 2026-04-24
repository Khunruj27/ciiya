'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'

export default function SignupPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })

    setLoading(false)

    if (error) {
      setErrorMsg(error.message)
      return
    }

    setSuccessMsg('Account created. Please check your email for confirmation.')
    router.push('/login')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto max-w-md pt-16">
        <h1 className="text-4xl font-bold text-slate-900">Create your Racky account</h1>
        <p className="mt-3 text-slate-500">
          Start managing albums and sharing photos with clients.
        </p>

        <form onSubmit={handleSignup} className="mt-10 space-y-5">
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

          <div>
            <label className="mb-2 block text-sm text-slate-500">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              className="w-full rounded-2xl bg-slate-100 px-4 py-4 outline-none"
            />
          </div>

          {errorMsg ? <p className="text-sm text-red-500">{errorMsg}</p> : null}
          {successMsg ? <p className="text-sm text-green-600">{successMsg}</p> : null}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-2xl bg-blue-600 px-4 py-4 text-white disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>

          <p className="text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="text-blue-600">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}