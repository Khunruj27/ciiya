'use client'

import { useMemo, useRef, useState } from 'react'

type Props = {
  shareToken: string
}

function getShareUrl(relativeUrl: string) {
  if (typeof window === 'undefined') {
    return relativeUrl
  }

  return `${window.location.origin}${relativeUrl}`
}

export default function PublicActionsBar({ shareToken }: Props) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const relativeUrl = useMemo(() => `/share/${shareToken}`, [shareToken])
  const shareUrl = getShareUrl(relativeUrl)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)

      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current)
      }

      copiedTimerRef.current = setTimeout(() => {
        setCopied(false)
      }, 1800)
    } catch {
      alert('Copy failed')
    }
  }

  function handleNativeShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator
        .share({
          title: 'Ciiya Gallery',
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
          <h3 className="text-sm font-semibold text-ink">Share Album</h3>
          <p className="text-xs text-muted">
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
          className="rounded-full bg-ink px-4 py-2 text-sm text-white"
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

      <p className="mt-4 break-all rounded-2xl bg-ground-sunken px-4 py-3 text-xs text-muted">
        {shareUrl}
      </p>
    </div>
  )
}