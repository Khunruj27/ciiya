'use client'

import { useEffect, useMemo, useState } from 'react'

type Props = {
  shareToken: string
}

export default function PublicActionsBar({ shareToken }: Props) {
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  // URL แบบ relative (ใช้ตอน SSR)
  const relativeUrl = useMemo(() => `/share/${shareToken}`, [shareToken])

  // URL แบบเต็ม (ใช้หลัง mount)
  const shareUrl = origin ? `${origin}${relativeUrl}` : relativeUrl

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      alert('Copy failed')
    }
  }

  function handleNativeShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator
        .share({
          title: 'Racky Gallery',
          text: 'Check out this photo album',
          url: shareUrl,
        })
        .catch(() => {})
      return
    }

    handleCopy()
  }

  const encodedUrl = encodeURIComponent(shareUrl)
  const encodedText = encodeURIComponent('Check out this photo album')

  const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodedUrl}`
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
  const xUrl = `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`

  return (
    <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Share Album</h3>
          <p className="text-xs text-slate-500">
            Copy link or share via social
          </p>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="rounded-full bg-blue-600 px-4 py-2 text-sm text-white"
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleNativeShare}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Share
        </button>

        <a
          href={lineUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-green-500 px-4 py-2 text-sm text-white"
        >
          LINE
        </a>

        <a
          href={facebookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-blue-500 px-4 py-2 text-sm text-white"
        >
          Facebook
        </a>

        <a
          href={xUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-black px-4 py-2 text-sm text-white"
        >
          X
        </a>
      </div>

      <p className="mt-4 break-all rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
        {shareUrl}
      </p>
    </div>
  )
}