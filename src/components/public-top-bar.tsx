'use client'

import { useRef, useState } from 'react'

export default function PublicTopBar({
  shareToken,
}: {
  shareToken: string
  count: number
}) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function getShareUrl() {
    const sharePath = `/share/${shareToken}`

    if (typeof window === 'undefined') {
      return sharePath
    }

    return `${window.location.origin}${sharePath}`
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(getShareUrl())
      setCopied(true)

      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current)
      }

      copiedTimerRef.current = setTimeout(() => {
        setCopied(false)
      }, 1500)
    } catch {
      alert('Copy failed')
    }
  }

  return (
    <div className="rounded-[32px] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="rounded-full bg-ground-sunken px-4 py-2.5 text-sm"
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
      </div>
    </div>
  )
}