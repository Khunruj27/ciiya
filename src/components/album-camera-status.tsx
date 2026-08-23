'use client'

import { useEffect, useRef, useState } from 'react'

const AUTO_DETECT_POLL_MS = 6000

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

        if (!showSettings && session?.resize_mode) {
  const nextResizeMode = String(
    session.resize_mode
  ).toLowerCase()

  if (
    nextResizeMode === 'original' ||
    nextResizeMode === 'uhd' ||
    nextResizeMode === 'hd' ||
    nextResizeMode === 'sd'
  ) {
    setResizeMode(nextResizeMode)
  }
}

     if (!showSettings && sessionJson?.active && session) {
  if (typeof session.preset_path === 'string') {
    setPresetPath(session.preset_path)
  }

 if (session.resize_mode === 'sd') {
  setResizeMode('sd')
} else if (session.resize_mode === 'uhd') {
  setResizeMode('uhd')
} else if (session.resize_mode === 'hd') {
  setResizeMode('hd')
} else {
  setResizeMode('original')
}
}


        if (typeof session?.auto_publish === 'boolean') {
          setAutoPublish(session.auto_publish)
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

  async function connectCamera(auto = false) {
    setBusy(true)
    if (!auto) setErrorMsg('')

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
  cameraName: json.cameraName || 'Camera Connected',
})

setAutoUploadActive(false)

if (auto) {
  await startAutoUpload()
} else {
  setPendingConnect(true)
  setShowSettings(true)
}
    } catch (error) {
      if (!auto) {
        setErrorMsg(error instanceof Error ? error.message : 'Connect failed')
      }
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

  async function startAutoUpload() {
    setBusy(true)
    setErrorMsg('')

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

    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : 'Start auto upload failed'
      )
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

    autoDetectingRef.current = true

    try {
      await connectCamera(true)
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
    <section className="pt-5">
      <div className="rounded-[24px] border border-black/5 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-black uppercase tracking-[0.14em] text-[#8E8E93]">
              Camera
            </p>

             {errorMsg ? (
  <p className="mt-3 text-[12px] font-bold text-red-500">
    {errorMsg}
  </p>
) : null}

            <p className="mt-1 truncate text-[16px] font-black text-[#1C0617]">
              {cameraState?.connected
                ? cameraState.cameraName || 'Camera Connected'
                : 'No Camera Connected'}
            </p>

            <p className="mt-1 text-[12px] font-semibold text-[#8E8E93]">
              {cameraState?.connected
                ? autoUploadActive
                  ? 'Auto upload is running'
                  : 'Configure processing before shooting'
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

          
      {showSettings && cameraState?.connected && (
  <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
    <div className="w-full max-w-[380px] rounded-[28px] bg-white p-5">

      <h3 className="text-[18px] font-black text-[#1C0617]">
        Processing Settings
      </h3>

      <p className="mt-1 text-[12px] text-[#8E8E93]">
        Configure resize and preset
      </p>

      {/* Resize */}

      <div className="mt-5">
        <div className="mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-[#8E8E93]">
          Resize
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
                'h-11 rounded-2xl text-[12px] font-black transition',
                resizeMode === size
                  ? 'bg-[#1C0617] text-white'
                  : 'bg-[#F6F7FA] text-[#1C0617]',
              ].join(' ')}
            >
              {size.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* XMP */}

      <div className="mt-5">
        <div className="mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-[#8E8E93]">
          XMP Preset
        </div>

       {recentPresets.length > 0 ? (
  <div className="mb-3 flex gap-2 overflow-x-auto">
    {recentPresets.map((preset) => (
      <button
        key={preset.path}
        type="button"
        onClick={() => setPresetPath(preset.path)}
        className={[
          'shrink-0 rounded-full px-3 py-2 text-[11px] font-black',
          presetPath === preset.path
            ? 'bg-[#1C0617] text-white'
            : 'bg-[#F6F7FA] text-[#1C0617]',
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
          className="h-12 w-full rounded-2xl border border-black/5 bg-[#F6F7FA] px-4 text-[13px] font-bold"
        >
          <option value="">None</option>

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
      'flex h-11 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-black/10 bg-[#F6F7FA] text-[12px] font-black',
      uploadingPreset
        ? 'pointer-events-none opacity-50'
        : '',
    ].join(' ')}
  >
    {uploadingPreset ? 'Uploading...' : '+ Upload XMP'}
  </label>
</div>

      {/* Footer */}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={cancelSettings}
          className="h-11 flex-1 rounded-full bg-[#F6F7FA] font-black"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={startAutoUpload}
          disabled={busy}
          className="h-11 flex-1 rounded-full bg-[#1C0617] font-black text-white"
        >
          Start
        </button>
      </div>
    </div>
  </div>
)}

   <div className="mt-4 flex gap-2">
  {cameraState?.connected ? (
    <>
      {autoUploadActive ? (
        <button
          type="button"
          onClick={openSettingsFromActiveSession}
          disabled={busy}
          className="rounded-full bg-[#F6F7FA] px-4 py-2 text-[12px] font-black text-[#1C0617] disabled:opacity-50"
        >
          Settings
        </button>
      ) : null}

      <button
        type="button"
        onClick={disconnectCamera}
        disabled={busy}
        className="rounded-full bg-[#1C0617] px-4 py-2 text-[12px] font-black text-white disabled:opacity-50"
      >
        {busy ? 'Stopping...' : 'Disconnect'}
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={() => connectCamera()}
      disabled={busy}
      className="rounded-full bg-[#D0F578] px-4 py-2 text-[12px] font-black text-[#1C0617] disabled:opacity-50"
    >
      {busy ? 'Connecting...' : 'Connect Camera'}
    </button>
  )}
</div>
      </div>
    </section>
  )
}