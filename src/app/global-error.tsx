'use client'

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full items-center justify-center bg-[#F9F9F9] px-6 text-black">
        <div className="w-full max-w-[393px] rounded-[28px] bg-white p-6 text-center border border-black/5">
          <h1 className="text-[24px] font-black">Something went wrong</h1>

          <p className="mt-3 text-[14px] font-semibold leading-6 text-[#8E8E93]">
            The app hit an unexpected error. Please try again.
          </p>

          <button
            type="button"
            onClick={() => unstable_retry()}
            className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-[#1C0617] px-5 text-[13px] font-black text-white"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
