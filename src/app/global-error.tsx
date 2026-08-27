'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('[global error boundary]', error)
  }, [error])

  return (
    <html lang="th" className="h-full">
      <body className="flex min-h-full items-center justify-center bg-ground px-6 text-black">
        <div className="w-full max-w-[393px] rounded-panel bg-white p-6 text-center border border-line">
          <h1 className="text-[24px] font-semibold">An error occurred</h1>

          <p className="mt-3 text-[14px] font-semibold leading-6 text-muted">
            An error occurred. Please try again
          </p>

          <button
            type="button"
            onClick={() => unstable_retry()}
            className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
