'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'

export default function GoogleSignInButton({
  next = '/albums',
  label = 'ดำเนินการต่อด้วย Google',
  onError,
}: {
  next?: string
  label?: string
  onError?: (message: string) => void
}) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    onError?.('')

    const supabase = createClient()

    /*
     * redirectTo is built from the live origin rather than a configured site
     * URL so the same build works on localhost, preview deployments, and
     * production without sending anyone back to the wrong host.
     */
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          next
        )}`,
      },
    })

    // On success the browser leaves for Google, so only failures land here.
    if (error) {
      setLoading(false)
      onError?.(error.message)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      /*
       * Ink-filled rather than the usual white pill: this is the only action
       * on the page now, and a white button sitting on a white card had no
       * hierarchy at all. Google's brand guidance allows a dark button as
       * long as the mark keeps its own colours, which it does below.
       */
      className="flex h-13 w-full items-center justify-center gap-3 rounded-control bg-ink px-5 text-[15px] font-medium text-white transition hover:bg-ink-soft active:scale-[0.98] disabled:opacity-50"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          fill="#4285F4"
          d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.28a12 12 0 0 0 0 10.77l4.01-3.11z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.18 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4.01 3.1C6.23 6.87 8.88 4.75 12 4.75z"
        />
        </svg>
      </span>

      {loading ? 'กำลังพาไปหน้า Google…' : label}
    </button>
  )
}
