'use client'

import { useState } from 'react'
import Link from 'next/link'
import GoogleSignInButton from '@/components/google-sign-in-button'

/*
 * Google is the only way in. The Supabase email provider is disabled, so a
 * password form here could only ever return "Email logins are disabled" —
 * every existing account has a linked Google identity on the same address.
 */
export default function LoginForm({
  initialError = '',
}: {
  initialError?: string
}) {
  // /auth/callback has no UI of its own, so it reports provider and
  // code-exchange failures by sending the visitor back here with ?error=.
  // The page reads it server-side and hands it down, which keeps that message
  // in the first HTML response instead of appearing only after hydration.
  const [errorMsg, setErrorMsg] = useState(initialError)

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
            <GoogleSignInButton next="/albums" onError={setErrorMsg} />

            {errorMsg ? (
              <p className="mt-4 rounded-panel border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
                {errorMsg}
              </p>
            ) : null}

            <p className="mt-4 px-2 text-center text-[12px] font-normal leading-5 text-muted">
              Sign in with your Google account — no password to remember
            </p>

            <div className="mt-4 rounded-panel bg-ground px-4 py-4 text-center">
              <p className="text-[13px] font-normal text-muted">
                Don’t have an account?
              </p>

              <Link
                href="/signup"
                className="mt-2 inline-block text-[13px] font-semibold text-ink underline decoration-gold decoration-2 underline-offset-4"
              >
                Sign up with Google
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
