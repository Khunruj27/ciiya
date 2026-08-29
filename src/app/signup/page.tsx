'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import GoogleSignInButton from '@/components/google-sign-in-button'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleEmailSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail) {
      setErrorMsg('Please enter your email')
      return
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters')
      return
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match')
      return
    }

    setEmailLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          '/albums'
        )}`,
      },
    })

    if (error) {
      setEmailLoading(false)
      setErrorMsg(error.message)
      return
    }

    if (data.session) {
      router.replace('/albums')
      router.refresh()
      return
    }

    setEmailLoading(false)
    setSuccessMsg(
      'Your account is almost ready. Check your email and confirm your address to continue.'
    )
  }

  function handleProviderError(message: string) {
    setSuccessMsg('')
    setErrorMsg(message)
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
            href="/login"
            className="flex h-11 items-center justify-center rounded-full border border-line bg-surface/80 px-5 text-[13px] font-semibold text-ink backdrop-blur-xl transition active:scale-95"
          >
            Sign in
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-2 lg:gap-20">
          <div className="px-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 backdrop-blur-xl">
              <span className="h-2 w-2 rounded-full bg-gold" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Get started with Ciiya
              </span>
            </div>

            <h1 className="mt-6 text-[clamp(2.7rem,7vw,5rem)] font-semibold leading-[0.95] tracking-[-0.05em] text-ink">
              Start keeping your important photos<br />beautifully
            </h1>

            <p className="mt-4 max-w-[320px] text-[14px] font-normal leading-6 text-muted">
              Create jobs, upload photos, share galleries, and deliver memories like a pro
            </p>
          </div>

          <div className="w-full rounded-hero border border-line bg-surface/90 p-5 shadow-lift backdrop-blur-xl sm:p-7 lg:ml-auto lg:max-w-md">
            <form onSubmit={handleEmailSignup} className="space-y-4">
              <div>
                <label
                  htmlFor="signup-email"
                  className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                >
                  Email
                </label>
                <input
                  id="signup-email"
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="signup-password"
                    className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                  >
                    Password
                  </label>
                  <input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                    className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
                  />
                </div>

                <div>
                  <label
                    htmlFor="signup-confirm-password"
                    className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                  >
                    Confirm password
                  </label>
                  <input
                    id="signup-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Enter it again"
                    required
                    minLength={6}
                    className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={emailLoading}
                className="flex h-13 w-full items-center justify-center rounded-control bg-ink px-5 text-[15px] font-medium text-white transition hover:bg-ink-soft active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
              >
                {emailLoading ? 'Creating account…' : 'Sign up with email'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                or
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <GoogleSignInButton
              next="/albums"
              label="Sign up with Google"
              onError={handleProviderError}
            />

            {errorMsg ? (
              <p className="mt-4 rounded-panel border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
                {errorMsg}
              </p>
            ) : null}

            {successMsg ? (
              <p className="mt-4 rounded-panel border border-emerald-100 bg-emerald-50 px-4 py-3 text-[13px] font-medium leading-5 text-emerald-700">
                {successMsg}
              </p>
            ) : null}

            <div className="mt-4 rounded-panel bg-ground px-4 py-4 text-center">
              <p className="text-[13px] font-normal text-muted">
                Already have an account?
              </p>

              <Link
                href="/login"
                className="mt-2 inline-block text-[13px] font-semibold text-ink underline decoration-gold decoration-2 underline-offset-4"
              >
                Sign in
              </Link>
            </div>
          </div>

          <p className="mt-6 text-center text-[11px] font-normal text-muted">
            © 2026 Ciiya • A premium photo gallery platform
          </p>
        </section>
      </div>
    </main>
  )
}
