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
    <main className="flex min-h-dvh items-center justify-center bg-ground px-6 text-ink">
      <div className="w-full max-w-md rounded-hero bg-surface p-6 text-center border border-line shadow-card">
        <h1 className="text-[24px] font-semibold">An error occurred</h1>

        <p className="mt-3 text-[14px] font-semibold leading-6 text-muted">
          A temporary error occurred. Please try again or go back home
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white"
          >
            Try again
          </button>

          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-5 text-[13px] font-semibold text-black"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}
