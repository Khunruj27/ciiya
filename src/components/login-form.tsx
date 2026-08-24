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

          <div className="rounded-[34px] border border-black/5 bg-white/90 p-4 backdrop-blur-xl">
            <GoogleSignInButton next="/albums" onError={setErrorMsg} />

            {errorMsg ? (
              <p className="mt-4 rounded-[20px] border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-bold text-red-500">
                {errorMsg}
              </p>
            ) : null}

            <p className="mt-4 px-2 text-center text-[12px] font-semibold leading-5 text-[#8E8E93]">
              เข้าใช้งานด้วยบัญชี Google ไม่ต้องจำรหัสผ่าน
            </p>

            <div className="mt-4 rounded-[24px] bg-[#FAF7F4] px-4 py-4 text-center">
              <p className="text-[13px] font-semibold text-[#8E8E93]">
                ยังไม่มีบัญชี?
              </p>

              <Link
                href="/signup"
                className="mt-2 inline-block text-[13px] font-black text-[#1C0617]"
              >
                สมัครด้วย Google
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
