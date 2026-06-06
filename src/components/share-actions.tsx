'use client'

import { useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import AppIcon from '@/components/app-icon'

type Props = {
  shareToken: string | null
}

function getFullShareUrl(sharePath: string) {
  if (!sharePath) return ''

  if (typeof window === 'undefined') {
    return sharePath
  }

  return `${window.location.origin}${sharePath}`
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'

  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export default function ShareActions({ shareToken }: Props) {
  const [showQR, setShowQR] = useState(false)
  const [copied, setCopied] = useState(false)

  const qrWrapperRef = useRef<HTMLDivElement | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sharePath = useMemo(() => {
    if (!shareToken) return ''
    return `/share/${shareToken}`
  }, [shareToken])

  const fullShareUrl = getFullShareUrl(sharePath)

  async function handleCopy() {
    if (!fullShareUrl) return

    try {
      await copyText(fullShareUrl)
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

  function handleDownloadQR() {
    const svg = qrWrapperRef.current?.querySelector('svg')
    if (!svg) return

    const serializer = new XMLSerializer()
    const svgString = serializer.serializeToString(svg)
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = 'ciiya-share-qr.svg'
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
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowQR(true)}
          aria-label="Show QR code"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black transition active:scale-95"
        >
          <AppIcon name="code" size={24} className="opacity-90" />
        </button>

        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy public share link"
          className={`flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 active:scale-95 ${
            copied
              ? 'bg-[#F0B1DE] text-white'
              : 'bg-[#F6F7FA] text-black'
          }`}
        >
          <AppIcon
            name={copied ? 'multiple-light' : 'multiple'}
            size={24}
            className={copied ? 'opacity-100' : 'opacity-90'}
          />
        </button>

        <a
          href={sharePath}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open public share page"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F6F7FA] text-black transition active:scale-95"
        >
          <AppIcon name="forward" size={24} className="opacity-90" />
        </a>
      </div>

      {showQR ? (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 px-5 pt-[max(60px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))] backdrop-blur-md sm:items-center">
          <button
            type="button"
            aria-label="Close QR backdrop"
            onClick={() => setShowQR(false)}
            className="absolute inset-0 cursor-default"
          />

          <div className="relative z-10 w-full max-w-[360px] overflow-hidden rounded-[30px] bg-white sm:max-w-[390px] sm:rounded-[34px]">
            <div className="flex items-start justify-between px-5 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-5">
              <div>
                <h2 className="mt-2 text-[26px] font-black leading-none tracking-[-0.05em] text-black sm:text-[30px]">
                  QR Code
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setShowQR(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F6F7FA] text-2xl font-black leading-none text-black transition active:scale-95"
                aria-label="Close QR modal"
              >
                ×
              </button>
            </div>

            <div className="px-6">
              <div className="rounded-[26px] bg-[#D0F578] p-4 text-white sm:rounded-[30px] sm:p-5">

                <div className="mt-4 flex justify-center">
                  <div
                    ref={qrWrapperRef}
                    className="rounded-[28px] bg-white p-5"
                  >
                    <QRCodeSVG value={fullShareUrl || sharePath} size={210} />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 px-6 pb-6 pt-5">
              <button
                type="button"
                onClick={handleCopy}
                className="flex h-14 w-full items-center justify-center rounded-[18px] bg-[#F5F5F7]  text-[15px] font-bold text-black border border-black/5 transition active:scale-[0.98]"
              >
                {copied ? 'Copied!' : 'Copy Link'}
              </button>

              <button
                type="button"
                onClick={handleDownloadQR}
                className="flex h-14 w-full items-center justify-center rounded-[18px] bg-[#F0B1DE] border border-black/5 text-[15px] font-bold text-white transition active:scale-[0.98]"
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