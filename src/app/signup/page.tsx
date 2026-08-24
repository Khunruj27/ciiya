'use client'

import { useState } from 'react'
import Link from 'next/link'
import GoogleSignInButton from '@/components/google-sign-in-button'

/*
 * Signup is Google-only. Email/password signup let anyone claim an address
 * they did not control — with confirmation off nothing verified it, and
 * Supabase would later link the real owner's Google identity into that
 * squatted account. Google verifies the address before we ever see it, so
 * this removes the squat without adding a confirmation step.
 *
 * Existing password accounts still sign in at /login; only creating new ones
 * this way is gone.
 */
export default function SignupPage() {
  const [errorMsg, setErrorMsg] = useState('')

  return (
    <main className="min-h-dvh overflow-hidden bg-ground text-ink">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-32 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-gold/15 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[393px] flex-col px-5 pt-[max(52px,env(safe-area-inset-top))] pb-[max(30px,env(safe-area-inset-bottom))]">
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
            Login
          </Link>
        </header>

        <section className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-7 px-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 backdrop-blur-xl">
              <span className="h-2 w-2 rounded-full bg-gold" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Join Ciiya
              </span>
            </div>

            <h1 className="mt-6 text-[46px] font-bold leading-[0.92] tracking-[-0.055em] text-ink">
              Start your
              <br />
              photo journey.
            </h1>

            <p className="mt-4 max-w-[320px] text-[14px] font-normal leading-6 text-muted">
              Create albums, upload event photos, share galleries, and deliver
              memories beautifully.
            </p>
          </div>

          <div className="rounded-hero border border-line bg-surface/90 p-4 shadow-card backdrop-blur-xl">
            <GoogleSignInButton
              next="/albums"
              label="Sign up with Google"
              onError={setErrorMsg}
            />

            {errorMsg ? (
              <p className="mt-4 rounded-panel border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
                {errorMsg}
              </p>
            ) : null}

            <p className="mt-4 px-2 text-center text-[12px] font-normal leading-5 text-muted">
              สมัครเสร็จเข้าใช้งานได้ทันที ไม่ต้องตั้งรหัสผ่านหรือยืนยันอีเมล
            </p>

            <div className="mt-4 rounded-panel bg-ground px-4 py-4 text-center">
              <p className="text-[13px] font-normal text-muted">
                Already have an account?
              </p>

              <Link
                href="/login"
                className="mt-2 inline-block text-[13px] font-semibold text-ink underline decoration-gold decoration-2 underline-offset-4"
              >
                Log in instead
              </Link>
            </div>
          </div>

          <p className="mt-6 text-center text-[11px] font-normal text-muted">
            © 2026 Ciiya • Premium Event Gallery Platform
          </p>
        </section>
      </div>
    </main>
  )
}
