'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState(() => {
    if (typeof window === 'undefined') return ''

    return window.localStorage.getItem('ciiya_remember_email') || ''
  })

  const [password, setPassword] = useState('')

  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window === 'undefined') return true

    return Boolean(window.localStorage.getItem('ciiya_remember_email'))
  })

  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setErrorMsg(error.message)
      return
    }

    if (rememberMe) {
      window.localStorage.setItem('ciiya_remember_email', email)
    } else {
      window.localStorage.removeItem('ciiya_remember_email')
    }

    router.push('/albums')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-[#EFEFF1] px-5 pt-[max(60px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))] text-black">
      <div className="mx-auto flex min-h-[calc(100dvh-100px)] w-full max-w-[390px] flex-col">
        <section className="px-6 pt-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[14px] font-bold text-black">
              <span className="h-3 w-3 rounded-full bg-black" />
              Welcome back
            </div>

            <Link
              href="/signup"
              className="flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-black text-black shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition active:scale-95"
            >
              Sign up
            </Link>
          </div>

          <h1 className="mt-8 text-[40px] font-black leading-[0.92] tracking-[-0.07em] text-black sm:text-[48px]">
            Log in to Ciiya.
          </h1>

          <p className="mt-4 text-[15px] font-medium leading-6 text-slate-500 sm:text-[16px] sm:leading-7">
            Manage albums, upload photos, and share galleries with your clients.
          </p>
        </section>

        <section className="pt-7">
          <form onSubmit={handleLogin} className="rounded-[30px] bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:rounded-[34px] sm:p-5">
            <div>
              <label className="text-sm font-black text-black/70">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-2 h-13 min-h-12 w-full rounded-[20px] border border-black/5 bg-[#F6F7FA] px-4 text-sm font-bold text-black outline-none placeholder:text-slate-400 focus:border-blue-600"
              />
            </div>

            <div className="mt-4">
              <label className="text-sm font-black text-black/70">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-2 h-13 w-full rounded-[20px] border border-black/5 bg-white px-4 text-sm font-bold text-black outline-none placeholder:text-slate-400 focus:border-blue-600"
              />
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded accent-blue-600"
                />
                Remember me
              </label>

              <Link href="/forgot-password" className="text-sm font-black text-black">
                Forgot?
              </Link>
            </div>

            {errorMsg ? (
              <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-red-500">
                {errorMsg}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mt-5 flex h-13 min-h-12 w-full items-center justify-center rounded-full bg-blue-600 px-4 text-sm font-black text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Log In'}
            </button>

            <p className="mt-5 text-center text-sm font-medium text-slate-500">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="font-black text-black">
                Sign up
              </Link>
            </p>
          </form>
        </section>

      </div>
    </main>
  )
}