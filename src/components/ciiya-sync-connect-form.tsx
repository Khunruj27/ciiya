'use client'

import { useMemo, useState } from 'react'

type ApprovalResult = {
  success?: boolean
  status?: string
  device?: {
    name?: string
    platform?: string
  }
  error?: string
  code?: string
}

function normalizeDisplayCode(value: string) {
  const characters = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)

  if (characters.length <= 4) return characters
  return `${characters.slice(0, 4)}-${characters.slice(4)}`
}

export default function CiiyaSyncConnectForm({
  initialCode = '',
}: {
  initialCode?: string
}) {
  const [code, setCode] = useState(() => normalizeDisplayCode(initialCode))
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ApprovalResult | null>(null)
  const canSubmit = useMemo(
    () => code.replace(/[^A-Z0-9]/g, '').length === 8 && !loading,
    [code, loading]
  )

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setResult(null)

    try {
      const response = await fetch('/api/ciiya-sync/pairing/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode: code }),
      })
      const json = (await response.json().catch(() => ({}))) as ApprovalResult

      if (!response.ok) {
        setResult({
          error:
            json.code === 'PAIRING_EXPIRED'
              ? 'รหัสหมดอายุแล้ว กรุณาสร้างรหัสใหม่จาก Ciiya Sync'
              : 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบรหัสแล้วลองอีกครั้ง',
          code: json.code,
        })
        return
      }

      setResult(json)
    } catch {
      setResult({
        error: 'ไม่สามารถติดต่อ Ciiya ได้ กรุณาตรวจสอบอินเทอร์เน็ต',
      })
    } finally {
      setLoading(false)
    }
  }

  if (result?.success) {
    return (
      <div className="rounded-[28px] border border-line bg-white p-6 text-center shadow-[0_18px_60px_rgba(20,18,15,0.08)] sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#efe2c2] text-2xl text-ink">
          ✓
        </div>
        <h2 className="mt-5 text-[24px] font-medium tracking-[-0.03em] text-ink">
          เชื่อมต่อแล้ว
        </h2>
        <p className="mt-2 text-[14px] leading-6 text-muted">
          {result.device?.name || 'คอมพิวเตอร์เครื่องนี้'} สามารถอ่านรายชื่ออัลบั้ม
          และเตรียมอัปโหลดผ่าน Ciiya Sync ได้แล้ว
        </p>
        <p className="mt-5 rounded-2xl bg-ground px-4 py-3 text-[13px] text-muted">
          กลับไปที่ Ciiya Sync เพื่อเลือกอัลบั้มและโฟลเดอร์ Lightroom
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[28px] border border-line bg-white p-6 shadow-[0_18px_60px_rgba(20,18,15,0.08)] sm:p-8"
    >
      <label
        htmlFor="ciiya-sync-code"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-deep"
      >
        Pairing code
      </label>
      <input
        id="ciiya-sync-code"
        name="code"
        value={code}
        onChange={(event) => setCode(normalizeDisplayCode(event.target.value))}
        inputMode="text"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="ABCD-EFGH"
        maxLength={9}
        className="mt-3 h-16 w-full rounded-2xl border border-line bg-ground px-5 text-center text-[24px] font-semibold tracking-[0.18em] text-ink outline-none transition focus:border-gold focus:ring-4 focus:ring-gold/10"
      />

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-4 flex min-h-13 w-full items-center justify-center rounded-2xl bg-ink px-5 text-[15px] font-medium text-white transition hover:bg-ink-soft active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ Ciiya Sync'}
      </button>

      {result?.error ? (
        <p
          role="alert"
          className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] leading-5 text-red-600"
        >
          {result.error}
        </p>
      ) : null}

      <p className="mt-5 text-[12px] leading-5 text-muted">
        อนุญาตเฉพาะการดูอัลบั้มและอัปโหลดรูปของบัญชีนี้ คุณสามารถเพิกถอนอุปกรณ์ได้ภายหลัง
        โดย Ciiya Sync จะไม่ได้รับ R2 Secret หรือ Supabase Service Role
      </p>
    </form>
  )
}
