'use client'

import { useEffect, useRef, useState } from 'react'

const AUTO_DETECT_POLL_MS = 3000
const AUTO_START_FAILURE_LIMIT = 3

type Props = {
  albumId: string
}

type CameraState = {
  connected: boolean
  cameraName: string | null
}

type ResizeMode = 'original' | 'uhd' | 'hd' | 'sd'

type PresetItem = {
  name: string
  path: string
}


export default function AlbumCameraStatus({ albumId }: Props) {
  const [cameraState, setCameraState] = useState<CameraState | null>(null)
  const [autoUploadActive, setAutoUploadActive] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [pendingConnect, setPendingConnect] = useState(false)

  const [presetPath, setPresetPath] = useState('')
  const [resizeMode, setResizeMode] = useState<ResizeMode>('hd')
  const [presets, setPresets] = useState<PresetItem[]>([])
  const [recentPresets, setRecentPresets] = useState<PresetItem[]>([])
  const [uploadingPreset, setUploadingPreset] = useState(false)

 
  const [autoPublish, setAutoPublish] = useState(false)
  

  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const autoDetectingRef = useRef(false)
  const autoConnectDisabledRef = useRef(false)
  const autoStartFailureCountRef = useRef(0)


  

useEffect(() => {
  let active = true

  async function loadPresets() {
    try {
      const [presetRes, recentRes] = await Promise.all([
        fetch('/api/presets/list', {
          cache: 'no-store',
        }),
        fetch('/api/presets/recent', {
          cache: 'no-store',
        }),
      ])

      const presetJson = await presetRes.json().catch(() => null)
      const recentJson = await recentRes.json().catch(() => null)

      if (!active) return

      setPresets(presetJson?.presets || [])
      setRecentPresets(recentJson?.presets || [])
    } catch {
      // ignore preset load errors
    }
  }

  loadPresets()

  return () => {
    active = false
  }
}, [])

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

        const session = sessionJson?.session || null

        setAutoUploadActive(Boolean(sessionJson?.active))

        // Pre-fill from the last session used on this album (active or
        // not) so a rushed reconnect reuses the same preset/resize choice
        // instead of resetting to bare defaults every time.
        if (!showSettings && session) {
          const nextResizeMode = String(session.resize_mode || '').toLowerCase()

          if (
            nextResizeMode === 'original' ||
            nextResizeMode === 'uhd' ||
            nextResizeMode === 'hd' ||
            nextResizeMode === 'sd'
          ) {
            setResizeMode(nextResizeMode)
          }

          if (typeof session.preset_path === 'string') {
            setPresetPath(session.preset_path)
          }

          if (typeof session.auto_publish === 'boolean') {
            setAutoPublish(session.auto_publish)
          }
        }
      } catch {
        // ignore camera status errors
      }
    }

    const firstLoadTimer = window.setTimeout(loadCameraStatus, 0)


    

    return () => {
      active = false
      window.clearTimeout(firstLoadTimer)
    
    }
  }, [albumId, showSettings])

  async function connectCamera(
    auto = false
  ): Promise<'no-camera' | 'started' | 'start-failed' | 'awaiting-settings'> {
    setBusy(true)

    if (!auto) {
      setErrorMsg('')
      // A manual connect is the user explicitly giving this another shot —
      // give auto-detect a clean slate too instead of leaving it permanently
      // given up from an earlier failure streak.
      autoConnectDisabledRef.current = false
      autoStartFailureCountRef.current = 0
    }

    try {
      const res = await fetch('/api/camera/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          albumId,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || 'Connect camera failed')
      }

      setCameraState({
  connected: true,
  cameraName: json.cameraName || 'เชื่อมต่อกล้องแล้ว',
})

setAutoUploadActive(false)

if (auto) {
  const started = await startAutoUpload(true)
  return started ? 'started' : 'start-failed'
} else {
  setPendingConnect(true)
  setShowSettings(true)
  return 'awaiting-settings'
}
    } catch (error) {
      if (!auto) {
        setErrorMsg(error instanceof Error ? error.message : 'Connect failed')
      }
      return 'no-camera'
    } finally {
      setBusy(false)
    }
  }


  async function disconnectCamera() {
    setBusy(true)
    setErrorMsg('')
    autoConnectDisabledRef.current = true

    try {
      const res = await fetch(`/api/camera/connect?albumId=${albumId}`, {
        method: 'DELETE',
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || 'Disconnect camera failed')
      }

      setCameraState({
        connected: false,
        cameraName: null,
      })

      setAutoUploadActive(false)
      setShowSettings(false)
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Disconnect failed')
    } finally {
      setBusy(false)
    }
  }

  async function startAutoUpload(auto = false) {
    setBusy(true)
    if (!auto) setErrorMsg('')

    try {
      const res = await fetch('/api/camera/upload-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          albumId,
          presetPath: presetPath.trim() || null,
          resizeMode,
          autoFaceScan: true,
          autoPublish,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || 'Start auto upload failed')
      }

      setPendingConnect(false)
setAutoUploadActive(true)
setShowSettings(false)
      
    if (presetPath) {
  const selectedPreset = presets.find((preset) => preset.path === presetPath)

  setRecentPresets((prev) => {
    const next = [
      selectedPreset || {
        path: presetPath,
        name: presetPath.split('/').pop()?.replace(/\.xmp$/i, '') || 'Preset',
      },
      ...prev.filter((preset) => preset.path !== presetPath),
    ]

    return next.slice(0, 3)
  })
}

      return true
    } catch (error) {
      if (!auto) {
        setErrorMsg(
          error instanceof Error ? error.message : 'Start auto upload failed'
        )
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  async function uploadPresetFile(file: File | null) {
  if (!file) return

  if (!file.name.toLowerCase().endsWith('.xmp')) {
    setErrorMsg('Only .xmp preset files are allowed')
    return
    
  }

  setUploadingPreset(true)
  setErrorMsg('')

  try {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/presets/upload', {
      method: 'POST',
      body: formData,
    })

    const json = await res.json().catch(() => null)

    if (!res.ok || !json?.success) {
      throw new Error(json?.error || 'Upload preset failed')
    }

    const cleanName = file.name.replace(/\.xmp$/i, '')
    

    const newPreset = {
      name: cleanName,
      path: json.path,
    }

    setPresets((prev) => [newPreset, ...prev])
    setPresetPath(json.path)
  } catch (error) {
    setErrorMsg(
      error instanceof Error ? error.message : 'Upload preset failed'
    )
  } finally {
    setUploadingPreset(false)
  }
}

async function cancelSettings() {
  setShowSettings(false)

  if (!pendingConnect) return

  autoConnectDisabledRef.current = true
  setPendingConnect(false)

  try {
    await fetch(`/api/camera/connect?albumId=${albumId}`, {
      method: 'DELETE',
    })

    setCameraState({
      connected: false,
      cameraName: null,
    })

    setAutoUploadActive(false)
  } catch {
    // ignore cancel disconnect error
  }
}

function openSettingsFromActiveSession() {
  setPendingConnect(false)
  setShowSettings(true)
}

// Plug-and-play: while this album page is open and nothing is actively
// capturing yet, poll for a camera on the USB port and start capturing on
// its own — no "Connect" click needed. Stops polling the moment a session
// is active (the background worker takes over gphoto2 polling from there)
// or after the user explicitly disconnects, so it never fights the worker
// for the USB device or silently reconnects something the user just
// stopped. Deliberately does NOT gate on cameraState.connected — that flag
// only reflects the last-known state in the database, and nothing marks it
// false when the cable is simply unplugged, so trusting it here would mean
// a page reload could never rediscover a reconnected camera.
useEffect(() => {
  if (autoUploadActive) return
  if (pendingConnect || showSettings) return
  if (autoConnectDisabledRef.current) return

  let cancelled = false

  async function tryAutoConnect() {
    if (cancelled || autoDetectingRef.current) return
    if (autoConnectDisabledRef.current) return

    autoDetectingRef.current = true

    try {
      const result = await connectCamera(true)

      if (result === 'started') {
        autoStartFailureCountRef.current = 0
        return
      }

      if (result === 'start-failed') {
        autoStartFailureCountRef.current += 1

        if (autoStartFailureCountRef.current >= AUTO_START_FAILURE_LIMIT) {
          autoConnectDisabledRef.current = true
          setErrorMsg(
            'เชื่อมกล้องสำเร็จแต่เริ่มถ่ายอัตโนมัติไม่ได้ กรุณากด Connect Camera ใหม่อีกครั้ง'
          )
        }
      }
      // 'no-camera' just means nothing is plugged in yet — keep waiting.
    } finally {
      autoDetectingRef.current = false
    }
  }

  tryAutoConnect()
  const interval = window.setInterval(tryAutoConnect, AUTO_DETECT_POLL_MS)

  return () => {
    cancelled = true
    window.clearInterval(interval)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [albumId, autoUploadActive, pendingConnect, showSettings])

  return (
    <section className="pt-4">
      {/*
        A status strip, not a feature card. The camera is disconnected for most
        of a session, and the old layout spent four stacked lines plus a pill
        plus its own button row saying so. The dot carries the state, the line
        says what it is, and the action sits on the same row.
      */}
      <div className="rounded-panel border border-line bg-surface px-3 py-2.5">
        <div className="flex items-center gap-3">
          <span
            className={[
              'grid h-8 w-8 shrink-0 place-items-center rounded-full',
              cameraState?.connected ? 'bg-gold-soft text-gold-deep' : 'bg-ground-sunken text-muted',
            ].join(' ')}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.7A1 1 0 0 1 8.6 5h6.8a1 1 0 0 1 .8.3L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v8A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5z" />
              <circle cx="12" cy="12.5" r="3.2" />
            </svg>
          </span>

          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
            <span
              className={[
                'mr-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full align-middle',
                autoUploadActive
                  ? 'bg-rose'
                  : cameraState?.connected
                    ? 'bg-gold'
                    : 'bg-line-strong',
              ].join(' ')}
            />
            {cameraState?.connected
              ? cameraState.cameraName || 'เชื่อมต่อกล้องแล้ว'
              : 'ยังไม่ได้เชื่อมต่อกล้อง'}
            <span className="text-muted">
              {cameraState?.connected
                ? autoUploadActive
                  ? ' · กำลังอัปโหลดอัตโนมัติ'
                  : ' · ยังไม่เริ่มอัปโหลด'
                : ' · ต่อผ่าน USB-C'}
            </span>
          </p>

          <div className="flex shrink-0 items-center gap-1.5">
            {cameraState?.connected ? (
              <>
                {autoUploadActive ? (
                  <button
                    type="button"
                    onClick={openSettingsFromActiveSession}
                    disabled={busy}
                    className="rounded-full px-3 py-1.5 text-[12px] font-medium text-muted transition hover:bg-ground-sunken hover:text-ink disabled:opacity-50"
                  >
                    ตั้งค่า
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={disconnectCamera}
                  disabled={busy}
                  className="rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition hover:bg-ground-sunken disabled:opacity-50"
                >
                  {busy ? 'กำลังหยุด…' : 'ตัดการเชื่อมต่อ'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => connectCamera()}
                disabled={busy}
                className="rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-ink-soft disabled:opacity-50"
              >
                {busy ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ'}
              </button>
            )}
          </div>
        </div>

        {errorMsg ? (
          <p className="mt-2 pl-11 text-[12px] font-medium text-red-600">
            {errorMsg}
          </p>
        ) : null}

        {showSettings && cameraState?.connected && (
  <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
    <div className="w-full max-w-[380px] rounded-panel bg-surface p-5">

      <h3 className="text-[18px] font-semibold text-ink">
        ตั้งค่าการประมวลผล
      </h3>

      <p className="mt-1 text-[12px] text-muted">
        เลือกขนาดภาพและพรีเซ็ต
      </p>

      {/* Resize */}

      <div className="mt-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          ขนาดภาพ
        </div>

        <div className="grid grid-cols-4 gap-2">
          {['sd', 'hd', 'uhd', 'original'].map((size) => (
            <button
              key={size}
              type="button"
              onClick={() =>
                setResizeMode(size as ResizeMode)
              }
              className={[
                'h-11 rounded-card text-[12px] font-semibold transition',
                resizeMode === size
                  ? 'bg-ink text-white'
                  : 'bg-ground-sunken text-ink',
              ].join(' ')}
            >
              {size.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* XMP */}

      <div className="mt-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          พรีเซ็ต XMP
        </div>

       {recentPresets.length > 0 ? (
  <div className="mb-3 flex gap-2 overflow-x-auto">
    {recentPresets.map((preset) => (
      <button
        key={preset.path}
        type="button"
        onClick={() => setPresetPath(preset.path)}
        className={[
          'shrink-0 rounded-full px-3 py-2 text-[11px] font-semibold',
          presetPath === preset.path
            ? 'bg-ink text-white'
            : 'bg-ground-sunken text-ink',
        ].join(' ')}
      >
        {preset.name}
      </button>
    ))}
  </div>
) : null}

        <select
          value={presetPath}
          onChange={(e) => setPresetPath(e.target.value)}
          className="h-12 w-full rounded-card border border-line bg-ground-sunken px-4 text-[13px] font-bold"
        >
          <option value="">ไม่ใช้พรีเซ็ต</option>

          {presets.slice(0, 3).map((preset) => (
            <option
              key={preset.path}
              value={preset.path}
            >
              {preset.name}
            </option>
          ))}
        </select>
      </div>

      {/* Upload XMP */}
<div className="mt-3">
  <input
    id="camera-xmp-upload"
    type="file"
    accept=".xmp"
    className="hidden"
    disabled={uploadingPreset}
    onChange={(e) => {
      uploadPresetFile(e.target.files?.[0] || null)

      e.currentTarget.value = ''
    }}
  />

  <label
    htmlFor="camera-xmp-upload"
    className={[
      'flex h-11 cursor-pointer items-center justify-center rounded-card border border-dashed border-line-strong bg-ground-sunken text-[12px] font-semibold',
      uploadingPreset
        ? 'pointer-events-none opacity-50'
        : '',
    ].join(' ')}
  >
    {uploadingPreset ? 'กำลังอัปโหลด…' : '+ อัปโหลด XMP'}
  </label>
</div>

      {/* Footer */}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={cancelSettings}
          className="h-11 flex-1 rounded-full bg-ground-sunken font-semibold"
        >
          ยกเลิก
        </button>

        <button
          type="button"
          onClick={() => startAutoUpload()}
          disabled={busy}
          className="h-11 flex-1 rounded-full bg-ink font-semibold text-white"
        >
          เริ่มใช้งาน
        </button>
      </div>
    </div>
  </div>
)}

      </div>
    </section>
  )
}
