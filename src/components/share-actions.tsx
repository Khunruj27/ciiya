'use client'

import { useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

type Props = {
  shareToken: string | null
}

export default function ShareActions({ shareToken }: Props) {
  const [showQR, setShowQR] = useState(false)
  const [copied, setCopied] = useState(false)
  const qrWrapperRef = useRef<HTMLDivElement | null>(null)

  const shareUrl = useMemo(() => {
    if (!shareToken) return ''
    if (typeof window === 'undefined') return `/share/${shareToken}`
    return `${window.location.origin}/share/${shareToken}`
  }, [shareToken])

  async function handleCopy() {
    if (!shareUrl) return

    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      alert('Copy failed')
    }
  }

  function handleDownloadQR() {
    const svg = qrWrapperRef.current?.querySelector('svg')
    if (!svg) return

    const serializer = new XMLSerializer()
    const svgString = serializer.serializeToString(svg)
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = 'racky-share-qr.svg'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    URL.revokeObjectURL(url)
  }

  if (!shareToken) {
    return null
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <a
          href={`/share/${shareToken}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-blue-50 px-4 py-2 text-sm text-blue-600"
        >
          Open Public Link
        </a>

        <button
          type="button"
          onClick={() => setShowQR(true)}
          className="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-700"
        >
          Show QR
        </button>
      </div>

      {showQR ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                Share QR Code
              </h2>

              <button
                type="button"
                onClick={() => setShowQR(false)}
                className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600"
              >
                Close
              </button>
            </div>

            <div className="mt-5 flex justify-center">
              <div
                ref={qrWrapperRef}
                className="rounded-2xl bg-white p-4 shadow-sm"
              >
                <QRCodeSVG value={shareUrl} size={220} />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={handleCopy}
                className="w-full rounded-2xl bg-slate-100 px-4 py-3 text-slate-700"
              >
                {copied ? 'Copied!' : 'Copy Link'}
              </button>

              <button
                type="button"
                onClick={handleDownloadQR}
                className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-white"
              >
                Download QR Code
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}