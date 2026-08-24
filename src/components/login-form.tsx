'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import GoogleSignInButton from '@/components/google-sign-in-button'

export default function LoginForm({
  initialError = '',
}: {
  initialError?: string
}) {
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

  // /auth/callback has no UI of its own, so it reports provider and
  // code-exchange failures by sending the visitor back here with ?error=.
  // The page reads it server-side and hands it down, which keeps that message
  // in the first HTML response instead of appearing only after hydration.
  const [errorMsg, setErrorMsg] = useState(initialError)

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
    <main className="min-h-dvh overflow-hidden bg-[#FAF7F4] text-[#1C0617]">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-24 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-[#F0B1DE]/45 blur-3xl" />
        <div className="absolute bottom-[-120px] right-[-120px] h-[320px] w-[320px] rounded-full bg-[#D0F578]/45 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[393px] flex-col px-5 pt-[max(52px,env(safe-area-inset-top))] pb-[max(34px,env(safe-area-inset-bottom))]">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-black/5 bg-white/80 text-[22px] font-black backdrop-blur-xl transition active:scale-95"
          >
            ‹
          </Link>

          <Link
            href="/signup"
            className="flex h-11 items-center justify-center rounded-full border border-black/5 bg-white/80 px-5 text-[13px] font-black text-[#1C0617] backdrop-blur-xl transition active:scale-95"
          >
            Sign up
          </Link>
        </header>

        <section className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-7 px-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/70 px-3 py-2 backdrop-blur-xl">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F0B1DE]" />
              <span className="text-[12px] font-black uppercase tracking-[0.16em] text-[#8E8E93]">
                Welcome back
              </span>
            </div>

            <h1 className="mt-6 text-[48px] font-black leading-[0.88] tracking-[-0.08em] text-[#1C0617]">
              Log in
              <br />
              to Ciiya.
            </h1>

            <p className="mt-4 max-w-[310px] text-[15px] font-semibold leading-6 text-[#8E8E93]">
              Manage albums, upload photos, and share galleries with your
              clients.
            </p>
          </div>

          <form
            onSubmit={handleLogin}
            className="rounded-[34px] border border-black/5 bg-white/90 p-4 backdrop-blur-xl"
          >
            <div className="rounded-[26px] bg-[#FAF7F4] p-3">
              <label className="px-2 text-[12px] font-black uppercase tracking-[0.12em] text-[#8E8E93]">
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 h-12 w-full rounded-[20px] border border-black/5 bg-white px-4 text-[15px] font-bold text-[#1C0617] outline-none placeholder:text-slate-300 focus:border-[#F0B1DE]"
              />
            </div>

            <div className="mt-3 rounded-[26px] bg-[#FAF7F4] p-3">
              <label className="px-2 text-[12px] font-black uppercase tracking-[0.12em] text-[#8E8E93]">
                Password
              </label>

              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 h-12 w-full rounded-[20px] border border-black/5 bg-white px-4 text-[15px] font-bold text-[#1C0617] outline-none placeholder:text-slate-300 focus:border-[#F0B1DE]"
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 px-1">
              <label className="flex items-center gap-2 text-[13px] font-bold text-[#8E8E93]">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#F0B1DE]"
                />
                Remember me
              </label>

              <Link
                href="/forgot-password"
                className="text-[13px] font-black text-[#1C0617]"
              >
                Forgot?
              </Link>
            </div>

            {errorMsg ? (
              <p className="mt-4 rounded-[20px] border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-bold text-red-500">
                {errorMsg}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mt-5 flex h-14 w-full items-center justify-center rounded-full border border-black/5 bg-[#F0B1DE] px-5 text-[15px] font-black text-[#1C0617] transition active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Log In'}
            </button>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-black/8" />
              <span className="text-[12px] font-black uppercase tracking-[0.12em] text-[#8E8E93]">
                or
              </span>
              <span className="h-px flex-1 bg-black/8" />
            </div>

            <GoogleSignInButton next="/albums" onError={setErrorMsg} />

            <p className="mt-5 text-center text-[13px] font-semibold text-[#8E8E93]">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="font-black text-[#1C0617]">
                Sign up
              </Link>
            </p>
          </form>
        </section>
      </div>
    </main>
  )
}