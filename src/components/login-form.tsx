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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  // /auth/callback has no UI of its own, so it reports provider and
  // code-exchange failures by sending the visitor back here with ?error=.
  // The page reads it server-side and hands it down, which keeps that message
  // in the first HTML response instead of appearing only after hydration.
  const [errorMsg, setErrorMsg] = useState(initialError)

  async function handleEmailLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail || !password) {
      setErrorMsg('Please enter your email and password')
      return
    }

    setEmailLoading(true)
    setErrorMsg('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    if (error) {
      setEmailLoading(false)
      setErrorMsg(error.message)
      return
    }

    router.replace('/albums')
    router.refresh()
  }

  return (
    <main className="min-h-dvh overflow-hidden bg-ground text-ink">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-32 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-gold/15 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[max(28px,env(safe-area-inset-bottom))] sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface/80 text-[22px] font-semibold backdrop-blur-xl transition active:scale-95"
          >
            ‹
          </Link>

          <Link
            href="/signup"
            className="flex h-11 items-center justify-center rounded-full border border-line bg-surface/80 px-5 text-[13px] font-semibold text-ink backdrop-blur-xl transition active:scale-95"
          >
            Sign up
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-2 lg:gap-20">
          <div className="px-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 backdrop-blur-xl">
              <span className="h-2 w-2 rounded-full bg-gold" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Welcome back
              </span>
            </div>

            <h1 className="mt-6 text-[clamp(2.7rem,7vw,5rem)] font-semibold leading-[0.95] tracking-[-0.05em] text-ink">
              Come back to keep<br />every moment
            </h1>

            <p className="mt-4 max-w-[310px] text-[14px] font-normal leading-6 text-muted">
              Manage jobs, upload photos, and share galleries with your clients from one place
            </p>
          </div>

          <div className="w-full rounded-hero border border-line bg-surface/90 p-5 shadow-lift backdrop-blur-xl sm:p-7 lg:ml-auto lg:max-w-md">
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="login-email"
                  className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                >
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label
                    htmlFor="login-password"
                    className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                  >
                    Password
                  </label>
                  <span className="text-[11px] text-muted">At least 6 characters</span>
                </div>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                  minLength={6}
                  className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
                />
              </div>

              <button
                type="submit"
                disabled={emailLoading}
                className="flex h-13 w-full items-center justify-center rounded-control bg-ink px-5 text-[15px] font-medium text-white transition hover:bg-ink-soft active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
              >
                {emailLoading ? 'Signing in…' : 'Sign in with email'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                or
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <GoogleSignInButton next="/albums" onError={setErrorMsg} />

            {errorMsg ? (
              <p className="mt-4 rounded-panel border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
                {errorMsg}
              </p>
            ) : null}

            <div className="mt-4 rounded-panel bg-ground px-4 py-4 text-center">
              <p className="text-[13px] font-normal text-muted">
                Don’t have an account?
              </p>

              <Link
                href="/signup"
                className="mt-2 inline-block text-[13px] font-semibold text-ink underline decoration-gold decoration-2 underline-offset-4"
              >
                Create an account
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
