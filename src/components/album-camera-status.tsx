'use client'

import { useEffect, useState } from 'react'

type Props = {
  albumId: string
}

type CameraState = {
  connected: boolean
  cameraName: string | null
}

export default function AlbumCameraStatus({ albumId }: Props) {
  const [cameraState, setCameraState] = useState<CameraState | null>(null)
  const [autoUploadActive, setAutoUploadActive] = useState(false)
  const [resizeMode, setResizeMode] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadCameraStatus() {
      try {
        const [res, sessionRes] = await Promise.all([
          fetch(`/api/camera/session?albumId=${albumId}`, {
            cache: 'no-store',
          }),
          fetch(`/api/camera/upload-session?albumId=${albumId}`, {
            cache: 'no-store',
          }),
        ])

        const cameraJson = res.ok ? await res.json() : null
        const sessionJson = sessionRes.ok ? await sessionRes.json() : null

        if (!active) return

        setCameraState({
          connected: Boolean(cameraJson?.connected),
          cameraName: cameraJson?.cameraName || null,
        })

        setAutoUploadActive(Boolean(sessionJson?.active))
        setResizeMode(sessionJson?.session?.resize_mode ?? null)
      } catch {
        // ignore camera status errors
      }
    }

    const firstLoadTimer = window.setTimeout(loadCameraStatus, 0)
    const timer = window.setInterval(loadCameraStatus, 5000)

    return () => {
      active = false
      window.clearTimeout(firstLoadTimer)
      window.clearInterval(timer)
    }
  }, [albumId])

  return (
    <section className="pt-5">
      <div className="rounded-[24px] border border-black/5 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-black uppercase tracking-[0.14em] text-[#8E8E93]">
              Camera
            </p>

            <p className="mt-1 truncate text-[16px] font-black text-[#1C0617]">
              {cameraState?.connected
                ? cameraState.cameraName || 'Camera Connected'
                : 'No Camera Connected'}
            </p>

            <p className="mt-1 text-[12px] font-semibold text-[#8E8E93]">
              {cameraState?.connected
                ? 'Watching for new photos'
                : 'Connect camera via USB-C'}
            </p>
          </div>

          <div
            className={[
              'flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase',
              cameraState?.connected
                ? 'bg-[#D0F578] text-[#1C0617]'
                : 'bg-[#FAF7F4] text-[#8E8E93]',
            ].join(' ')}
          >
            <span
              className={[
                'h-2 w-2 rounded-full',
                cameraState?.connected ? 'bg-[#1C0617]' : 'bg-[#C7C7CC]',
              ].join(' ')}
            />

            {cameraState?.connected ? 'Connected' : 'Offline'}
          </div>
        </div>

        {cameraState?.connected && autoUploadActive ? (
          <div className="mt-4 rounded-2xl bg-[#F7FAF1] px-4 py-3">
            <p className="text-[13px] font-black text-[#1C0617]">
              Waiting for new photos...
            </p>

            <p className="mt-1 text-[12px] font-semibold text-[#6B7280]">
              Auto Upload Active
              {resizeMode ? ` • ${resizeMode.toUpperCase()}` : ''}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}