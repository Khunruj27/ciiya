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
    <main className="min-h-dvh overflow-hidden bg-[#FAF7F4] text-[#1C0617]">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-28 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-[#D0F578]/45 blur-3xl" />
        <div className="absolute bottom-[-120px] left-[-120px] h-[320px] w-[320px] rounded-full bg-[#F0B1DE]/50 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[393px] flex-col px-5 pt-[max(52px,env(safe-area-inset-top))] pb-[max(30px,env(safe-area-inset-bottom))]">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-black/5 bg-white/80 text-[22px] font-black backdrop-blur-xl transition active:scale-95"
          >
            ‹
          </Link>

          <Link
            href="/login"
            className="flex h-11 items-center justify-center rounded-full border border-black/5 bg-white/80 px-5 text-[13px] font-black text-[#1C0617] backdrop-blur-xl transition active:scale-95"
          >
            Login
          </Link>
        </header>

        <section className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-7 px-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/70 px-3 py-2 backdrop-blur-xl">
              <span className="h-2.5 w-2.5 rounded-full bg-[#D0F578]" />
              <span className="text-[12px] font-black uppercase tracking-[0.16em] text-[#8E8E93]">
                Join Ciiya
              </span>
            </div>

            <h1 className="mt-6 text-[48px] font-black leading-[0.88] tracking-[-0.08em] text-[#1C0617]">
              Start your
              <br />
              photo journey.
            </h1>

            <p className="mt-4 max-w-[320px] text-[15px] font-semibold leading-6 text-[#8E8E93]">
              Create albums, upload event photos, share galleries, and deliver
              memories beautifully.
            </p>
          </div>

          <div className="rounded-[34px] border border-black/5 bg-white/90 p-4 backdrop-blur-xl">
            <GoogleSignInButton
              next="/albums"
              label="Sign up with Google"
              onError={setErrorMsg}
            />

            {errorMsg ? (
              <p className="mt-4 rounded-[20px] border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-bold text-red-500">
                {errorMsg}
              </p>
            ) : null}

            <p className="mt-4 px-2 text-center text-[12px] font-semibold leading-5 text-[#8E8E93]">
              สมัครเสร็จเข้าใช้งานได้ทันที ไม่ต้องตั้งรหัสผ่านหรือยืนยันอีเมล
            </p>

            <div className="mt-4 rounded-[24px] bg-[#FAF7F4] px-4 py-4 text-center">
              <p className="text-[13px] font-semibold text-[#8E8E93]">
                Already have an account?
              </p>

              <Link
                href="/login"
                className="mt-2 inline-block text-[13px] font-black text-[#1C0617]"
              >
                Log in instead
              </Link>
            </div>
          </div>

          <p className="mt-6 text-center text-xs font-semibold text-[#8E8E93]">
            © 2026 Ciiya • Premium Event Gallery Platform
          </p>
        </section>
      </div>
    </main>
  )
}
