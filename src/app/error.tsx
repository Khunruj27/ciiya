'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function GlobalErrorBoundary({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('[app error boundary]', error)
  }, [error])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F9F9F9] px-6 text-black">
      <div className="w-full max-w-[393px] rounded-[28px] bg-white p-6 text-center border border-black/5">
        <h1 className="text-[24px] font-black">Something went wrong</h1>

        <p className="mt-3 text-[14px] font-semibold leading-6 text-[#8E8E93]">
          An unexpected error occurred. You can try again or go back home.
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#1C0617] px-5 text-[13px] font-black text-white"
          >
            Try again
          </button>

          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-full border border-black/10 px-5 text-[13px] font-black text-black"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  )
}
