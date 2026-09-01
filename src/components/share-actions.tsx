'use client'

import { useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import AppIcon from '@/components/app-icon'
import { useI18n } from '@/components/i18n-provider'

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
  const { t } = useI18n()
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
      alert(t.shareActions.cantCopy)
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
          aria-label={t.shareActions.showQr}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-ground-sunken text-ink transition active:scale-95"
        >
          <AppIcon name="code" size={24} className="opacity-90" />
        </button>

        <button
          type="button"
          onClick={handleCopy}
          aria-label={t.shareActions.copyPublicLink}
          className={`flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 active:scale-95 ${
            copied
              ? 'bg-gold text-ink'
              : 'bg-ground-sunken text-ink'
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
          aria-label={t.shareActions.openSharePage}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-ground-sunken text-ink transition active:scale-95"
        >
          <AppIcon name="forward" size={24} className="opacity-90" />
        </a>
      </div>

      {showQR ? (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 px-5 pt-[max(60px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))] backdrop-blur-md sm:items-center">
          <button
            type="button"
            aria-label={t.shareActions.closeQr}
            onClick={() => setShowQR(false)}
            className="absolute inset-0 cursor-default"
          />

          <div className="relative z-10 w-full max-w-[360px] overflow-hidden rounded-hero border border-line bg-surface sm:max-w-[390px]">
            <div className="flex items-start justify-between px-5 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-5">
              <div>
                <h2 className="mt-2 text-[22px] font-semibold leading-none tracking-[-0.035em] text-ink sm:text-[24px]">
                  {t.shareActions.qrCode}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setShowQR(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-ground-sunken text-2xl font-normal leading-none text-ink transition active:scale-95"
                aria-label={t.shareActions.closeQr}
              >
                ×
              </button>
            </div>

            <div className="px-6">
              <div className="rounded-panel border border-gold/30 bg-gold-soft p-4 sm:p-5">
                <div className="flex justify-center">
                  {/* Pure white, not a token: scanners need the quiet zone
                      at full contrast, so this one surface stays literal. */}
                  <div
                    ref={qrWrapperRef}
                    className="rounded-card bg-white p-5"
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
                className="flex h-14 w-full items-center justify-center rounded-control border border-line bg-surface text-[14px] font-medium text-ink transition hover:border-line-strong active:scale-[0.98]"
              >
                {copied ? t.shareActions.copied : t.shareActions.copyLink}
              </button>

              <button
                type="button"
                onClick={handleDownloadQR}
                className="flex h-14 w-full items-center justify-center rounded-control bg-ink text-[14px] font-medium text-white transition hover:bg-ink-soft active:scale-[0.98]"
              >
                {t.shareActions.downloadQr}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
