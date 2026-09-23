'use client'

import { useState } from 'react'
import {
  Check,
  Laptop,
  Monitor,
  RefreshCcw,
  ShieldOff,
} from 'lucide-react'

export type CiiyaSyncDeviceListItem = {
  id: string
  client_device_id: string
  name: string
  platform: string
  app_version: string | null
  scopes: string[]
  token_expires_at: string
  last_seen_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

function relativeTime(value: string | null, locale: 'th' | 'en') {
  if (!value) return locale === 'th' ? 'ยังไม่เคยออนไลน์' : 'Never online'

  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '—'

  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const absolute = Math.abs(seconds)

  if (absolute < 60) return formatter.format(seconds, 'second')
  if (absolute < 60 * 60) return formatter.format(Math.round(seconds / 60), 'minute')
  if (absolute < 24 * 60 * 60) {
    return formatter.format(Math.round(seconds / (60 * 60)), 'hour')
  }
  return formatter.format(Math.round(seconds / (24 * 60 * 60)), 'day')
}

function platformName(value: string, locale: 'th' | 'en') {
  if (value === 'macos') return 'macOS'
  if (value === 'windows') return 'Windows'
  if (value === 'linux') return 'Linux'
  return locale === 'th' ? 'ไม่ทราบระบบ' : 'Unknown platform'
}

function statusFor(device: CiiyaSyncDeviceListItem) {
  if (device.revoked_at) return 'revoked'
  if (new Date(device.token_expires_at).getTime() <= Date.now()) return 'expired'
  return 'active'
}

export default function CiiyaSyncDevices({
  initialDevices,
  locale,
}: {
  initialDevices: CiiyaSyncDeviceListItem[]
  locale: 'th' | 'en'
}) {
  const [devices, setDevices] = useState(initialDevices)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function revokeDevice(device: CiiyaSyncDeviceListItem) {
    const confirmed = window.confirm(
      locale === 'th'
        ? `ตัดการเชื่อมต่อ “${device.name}” หรือไม่? เครื่องนี้จะอัปโหลดหรือดูอัลบั้มไม่ได้จนกว่าจะเชื่อมต่อใหม่`
        : `Disconnect “${device.name}”? It will lose album and upload access until it is paired again.`
    )

    if (!confirmed) return

    setBusyId(device.id)
    setError('')

    try {
      const response = await fetch('/api/ciiya-sync/devices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device.id }),
      })
      const result = (await response.json().catch(() => ({}))) as {
        revokedAt?: string
        error?: string
      }

      if (!response.ok) {
        throw new Error(result.error || 'DEVICE_REVOKE_FAILED')
      }

      setDevices((current) =>
        current.map((item) =>
          item.id === device.id
            ? { ...item, revoked_at: result.revokedAt || new Date().toISOString() }
            : item
        )
      )
    } catch {
      setError(
        locale === 'th'
          ? 'ตัดการเชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง'
          : 'Could not disconnect this device. Please try again.'
      )
    } finally {
      setBusyId(null)
    }
  }

  if (devices.length === 0) {
    return (
      <section className="rounded-[26px] border border-line bg-white px-5 py-10 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold-soft text-gold-deep">
          <Laptop size={24} strokeWidth={1.6} aria-hidden />
        </span>
        <h2 className="mt-5 text-[20px] font-medium tracking-[-0.025em] text-ink">
          {locale === 'th' ? 'ยังไม่มีอุปกรณ์ที่เชื่อมต่อ' : 'No connected devices'}
        </h2>
        <p className="mx-auto mt-2 max-w-[360px] text-[13px] leading-6 text-muted">
          {locale === 'th'
            ? 'เปิด Ciiya Sync บนคอมพิวเตอร์เพื่อรับรหัส แล้วนำรหัสมายืนยันกับบัญชีนี้'
            : 'Open Ciiya Sync on your computer, get a pairing code, and approve it with this account.'}
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] text-red-600">
          {error}
        </p>
      ) : null}

      {devices.map((device) => {
        const status = statusFor(device)
        const active = status === 'active'

        return (
          <article
            key={device.id}
            className="rounded-[24px] border border-line bg-white p-5 shadow-[0_12px_35px_rgba(20,18,15,0.045)]"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ground text-muted">
                {device.platform === 'macos' ? (
                  <Laptop size={20} strokeWidth={1.6} aria-hidden />
                ) : (
                  <Monitor size={20} strokeWidth={1.6} aria-hidden />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[16px] font-semibold tracking-[-0.02em] text-ink">
                    {device.name}
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${
                      active
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-ground text-muted'
                    }`}
                  >
                    {active ? <Check size={11} strokeWidth={2} aria-hidden /> : null}
                    {active
                      ? locale === 'th' ? 'เชื่อมต่ออยู่' : 'Connected'
                      : status === 'revoked'
                        ? locale === 'th' ? 'ตัดการเชื่อมต่อแล้ว' : 'Disconnected'
                        : locale === 'th' ? 'Token หมดอายุ' : 'Token expired'}
                  </span>
                </div>

                <p className="mt-1 text-[12px] text-muted">
                  {platformName(device.platform, locale)}
                  {device.app_version ? ` · Ciiya Sync ${device.app_version}` : ''}
                </p>
                <p className="mt-2 text-[12px] text-muted/85">
                  {locale === 'th' ? 'ใช้งานล่าสุด ' : 'Last active '}
                  {relativeTime(device.last_seen_at, locale)}
                </p>
              </div>
            </div>

            {active ? (
              <button
                type="button"
                onClick={() => revokeDevice(device)}
                disabled={busyId === device.id}
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 text-[13px] font-semibold text-ink transition hover:border-red-200 hover:text-red-600 active:scale-[0.99] disabled:cursor-wait disabled:opacity-50"
              >
                {busyId === device.id ? (
                  <RefreshCcw className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <ShieldOff className="h-4 w-4" strokeWidth={1.7} aria-hidden />
                )}
                {locale === 'th' ? 'ตัดการเชื่อมต่อ' : 'Disconnect'}
              </button>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
