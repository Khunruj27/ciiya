'use client'

import { useEffect, useState } from 'react'

export default function PublicTopBar({
  shareToken,
  count,
}: {
  shareToken: string
  count: number
}) {
  const [shareUrl, setShareUrl] = useState('')
  const [copied, setCopied] = useState(false)

  // ✅ แก้ hydration ตรงนี้
  useEffect(() => {
    setShareUrl(`${window.location.origin}/share/${shareToken}`)
  }, [shareToken])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      alert('Copy failed')
    }
  }

  const lineUrl = shareUrl
    ? `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(
        shareUrl
      )}`
    : '#'

  const fbUrl = shareUrl
    ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        shareUrl
      )}`
    : '#'

  return (
    <div className="rounded-[32px] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
      <div className="flex flex-wrap items-center gap-2">

        {/* Live */}
        <button className="rounded-full bg-blue-600 px-5 py-2.5 text-sm text-white">
          Live
        </button>

        {/* Trending */}
        <button className="rounded-full bg-slate-100 px-5 py-2.5 text-sm">
          Trending 🔥
        </button>

        {/* LINE */}
        <a
          href={lineUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-[#06C755]/10 px-4 py-2.5 text-sm text-[#06C755]"
        >
          LINE
        </a>

        {/* Facebook */}
        <a
          href={fbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-blue-100 px-4 py-2.5 text-sm text-blue-600"
        >
          Facebook
        </a>

        {/* Copy */}
        <button
          onClick={copyLink}
          className="rounded-full bg-slate-100 px-4 py-2.5 text-sm"
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>

        {/* Count */}
        <div className="ml-auto rounded-full bg-slate-100 px-3 py-2 text-xs">
          {count} items
        </div>
      </div>
    </div>
  )
}