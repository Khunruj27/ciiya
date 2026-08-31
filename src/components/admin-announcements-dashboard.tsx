'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Announcement = {
  id: string
  announcement_type: string
  title: string
  summary: string
  audience_type: string
  audience_values: string[]
  priority: string
  status: string
  starts_at: string
  expires_at: string | null
  created_at: string
  read_count: number
  click_count: number
}

const initialForm = {
  announcementType: 'update',
  title: '',
  summary: '',
  body: '',
  imageUrl: '',
  ctaLabel: '',
  ctaUrl: '',
  audienceType: 'all',
  plans: ['free', 'starter', 'pro', 'business'],
  recipientEmails: '',
  priority: 'normal',
  status: 'draft',
  startsAt: '',
  expiresAt: '',
}

function formatDate(value?: string | null) {
  if (!value) return 'ไม่กำหนดวันสิ้นสุด'
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function statusClass(status: string) {
  if (status === 'published') return 'bg-emerald-50 text-emerald-700'
  if (status === 'scheduled') return 'bg-blue-50 text-blue-700'
  if (status === 'cancelled' || status === 'expired') return 'bg-red-50 text-red-600'
  return 'bg-ground text-muted'
}

function statusLabel(status: string) {
  if (status === 'published') return 'เผยแพร่แล้ว'
  if (status === 'scheduled') return 'ตั้งเวลาแล้ว'
  if (status === 'cancelled') return 'ยกเลิกแล้ว'
  if (status === 'expired') return 'สิ้นสุดแล้ว'
  return 'ฉบับร่าง'
}

export default function AdminAnnouncementsDashboard() {
  const [form, setForm] = useState(initialForm)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadAnnouncements() {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/announcements', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'โหลดประกาศไม่สำเร็จ')
      setAnnouncements(data.announcements || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'โหลดประกาศไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAnnouncements(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const overview = useMemo(() => ({
    total: announcements.length,
    live: announcements.filter((item) => item.status === 'published').length,
    scheduled: announcements.filter((item) => item.status === 'scheduled').length,
    reads: announcements.reduce((sum, item) => sum + Number(item.read_count || 0), 0),
  }), [announcements])

  function update<K extends keyof typeof initialForm>(key: K, value: (typeof initialForm)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function togglePlan(plan: string) {
    setForm((current) => ({
      ...current,
      plans: current.plans.includes(plan)
        ? current.plans.filter((item) => item !== plan)
        : [...current.plans, plan],
    }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (form.status === 'scheduled' && !form.startsAt) {
      setError('กรุณาเลือกวันที่และเวลาที่ต้องการส่งประกาศ')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    const audienceValues = form.audienceType === 'plans'
      ? form.plans
      : form.audienceType === 'users'
        ? form.recipientEmails.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean)
        : []

    try {
      const response = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          audienceValues,
          startsAt: form.startsAt || null,
          expiresAt: form.expiresAt || null,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'สร้างประกาศไม่สำเร็จ')

      setForm(initialForm)
      setSuccess(form.status === 'draft' ? 'บันทึกฉบับร่างแล้ว' : form.status === 'scheduled' ? 'ตั้งเวลาส่งประกาศแล้ว' : 'เผยแพร่ประกาศแล้ว')
      await loadAnnouncements()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'สร้างประกาศไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  async function runAction(id: string, action: 'publish' | 'pause' | 'cancel') {
    setError('')
    const response = await fetch('/api/admin/announcements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    const data = await response.json()
    if (!response.ok) {
      setError(data?.error || 'อัปเดตประกาศไม่สำเร็จ')
      return
    }
    await loadAnnouncements()
  }

  return (
    <main className="min-h-dvh bg-ground px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-deep">ผู้ดูแลระบบ Ciiya</p>
            <h1 className="mt-2 text-[clamp(2.3rem,6vw,4rem)] font-semibold leading-none tracking-[-0.055em]">ประกาศข่าวสาร</h1>
            <p className="mt-3 max-w-xl text-[14px] leading-6 text-muted">ส่งข่าวสาร โปรโมชัน ฟีเจอร์ใหม่ และประกาศการให้บริการไปยังผู้ใช้ Ciiya</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/users" className="rounded-full border border-line bg-surface px-4 py-2.5 text-[12px] font-semibold">ผู้ใช้งาน</Link>
            <Link href="/notifications" className="rounded-full bg-ink px-4 py-2.5 text-[12px] font-semibold text-white">ดูหน้าผู้ใช้</Link>
          </div>
        </header>

        <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['ประกาศทั้งหมด', overview.total],
            ['กำลังเผยแพร่', overview.live],
            ['ตั้งเวลาแล้ว', overview.scheduled],
            ['ยอดอ่านทั้งหมด', overview.reads],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-panel border border-line bg-surface p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
              <p className="mt-2 text-[30px] font-semibold tracking-[-0.05em]">{value}</p>
            </div>
          ))}
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,.95fr)]">
          <form onSubmit={submit} className="rounded-hero border border-line bg-surface p-5 sm:p-7">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-deep">สร้างข้อความ</p>
              <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.04em]">สร้างประกาศใหม่</h2>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="ประเภท">
                <select value={form.announcementType} onChange={(event) => update('announcementType', event.target.value)} className="admin-input">
                  <option value="feature">ฟีเจอร์ใหม่</option><option value="promotion">โปรโมชัน</option><option value="update">อัปเดตผลิตภัณฑ์</option><option value="maintenance">แจ้งปิดปรับปรุง</option><option value="tip">เคล็ดลับ</option><option value="security">ความปลอดภัย</option>
                </select>
              </Field>
              <Field label="ความสำคัญ">
                <select value={form.priority} onChange={(event) => update('priority', event.target.value)} className="admin-input">
                  <option value="normal">ทั่วไป</option><option value="important">สำคัญ</option><option value="critical">เร่งด่วน</option>
                </select>
              </Field>
            </div>

            <div className="mt-4 space-y-4">
              <Field label="หัวข้อ"><input value={form.title} onChange={(event) => update('title', event.target.value)} maxLength={120} required placeholder="หัวข้อที่ชัดเจนและเข้าใจง่าย" className="admin-input" /></Field>
              <Field label="ข้อความสรุป"><textarea value={form.summary} onChange={(event) => update('summary', event.target.value)} maxLength={280} required placeholder="ข้อความที่แสดงบนหน้าแจ้งเตือน" className="admin-input min-h-24 resize-y py-3" /></Field>
              <Field label="รายละเอียด"><textarea value={form.body} onChange={(event) => update('body', event.target.value)} maxLength={5000} placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)" className="admin-input min-h-32 resize-y py-3" /></Field>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="ข้อความบนปุ่ม"><input value={form.ctaLabel} onChange={(event) => update('ctaLabel', event.target.value)} maxLength={40} placeholder="ดูรายละเอียด" className="admin-input" /></Field>
              <Field label="ลิงก์ปลายทาง"><input value={form.ctaUrl} onChange={(event) => update('ctaUrl', event.target.value)} placeholder="/pricing หรือ https://…" className="admin-input" /></Field>
            </div>
            <div className="mt-4"><Field label="ลิงก์รูปหน้าปก"><input value={form.imageUrl} onChange={(event) => update('imageUrl', event.target.value)} placeholder="https://… (ไม่บังคับ)" className="admin-input" /></Field></div>

            <div className="mt-6 rounded-panel border border-line p-4">
              <Field label="กลุ่มผู้รับ">
                <select value={form.audienceType} onChange={(event) => update('audienceType', event.target.value)} className="admin-input">
                  <option value="all">ผู้ใช้ทั้งหมด</option><option value="plans">เลือกตามแพ็กเกจ</option><option value="users">ระบุผู้ใช้</option>
                </select>
              </Field>

              {form.audienceType === 'plans' ? (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {['free', 'starter', 'pro', 'business'].map((plan) => (
                    <label key={plan} className={`cursor-pointer rounded-control border px-3 py-3 text-center text-[12px] font-semibold capitalize ${form.plans.includes(plan) ? 'border-gold bg-gold-soft text-gold-deep' : 'border-line text-muted'}`}>
                      <input type="checkbox" checked={form.plans.includes(plan)} onChange={() => togglePlan(plan)} className="sr-only" />{plan}
                    </label>
                  ))}
                </div>
              ) : null}

              {form.audienceType === 'users' ? (
                <div className="mt-4"><Field label="อีเมลผู้รับ"><textarea value={form.recipientEmails} onChange={(event) => update('recipientEmails', event.target.value)} placeholder={'user@example.com\none@example.com'} className="admin-input min-h-24 py-3" /></Field></div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="การส่ง">
                <select value={form.status} onChange={(event) => update('status', event.target.value)} className="admin-input">
                  <option value="draft">บันทึกฉบับร่าง</option><option value="published">เผยแพร่ทันที</option><option value="scheduled">ตั้งเวลาส่ง</option>
                </select>
              </Field>
              <Field label="วันเริ่มเผยแพร่"><input type="datetime-local" value={form.startsAt} onChange={(event) => update('startsAt', event.target.value)} className="admin-input" /></Field>
              <Field label="วันสิ้นสุด"><input type="datetime-local" value={form.expiresAt} onChange={(event) => update('expiresAt', event.target.value)} className="admin-input" /></Field>
            </div>

            {error ? <p className="mt-4 rounded-control border border-red-100 bg-red-50 px-4 py-3 text-[13px] text-red-600">{error}</p> : null}
            {success ? <p className="mt-4 rounded-control border border-emerald-100 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-700">{success}</p> : null}

            <button type="submit" disabled={saving} className="mt-6 flex h-13 w-full items-center justify-center rounded-control bg-ink text-[14px] font-semibold text-white disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : form.status === 'draft' ? 'บันทึกฉบับร่าง' : form.status === 'scheduled' ? 'ตั้งเวลาส่งประกาศ' : 'เผยแพร่ประกาศ'}
            </button>
          </form>

          <section className="rounded-hero border border-line bg-surface p-5 sm:p-7">
            <div className="flex items-end justify-between gap-4">
              <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-deep">ประวัติ</p><h2 className="mt-2 text-[24px] font-semibold tracking-[-0.04em]">ประกาศล่าสุด</h2></div>
              <button type="button" onClick={() => void loadAnnouncements()} className="text-[12px] font-semibold text-muted">รีเฟรช</button>
            </div>

            {loading ? <p className="mt-6 text-[13px] text-muted">กำลังโหลดประกาศ…</p> : announcements.length ? (
              <div className="mt-5 space-y-3">
                {announcements.map((item) => (
                  <article key={item.id} className="rounded-panel border border-line p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-deep">{item.announcement_type}</p><h3 className="mt-1 text-[15px] font-semibold leading-5">{item.title}</h3></div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-muted">{item.summary}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-control bg-ground p-3 text-center">
                      <div><p className="text-[16px] font-semibold">{item.read_count}</p><p className="text-[9px] uppercase text-muted">อ่านแล้ว</p></div>
                      <div><p className="text-[16px] font-semibold">{item.click_count}</p><p className="text-[9px] uppercase text-muted">คลิกลิงก์</p></div>
                      <div><p className="text-[16px] font-semibold">{item.audience_type === 'all' ? 'ทั้งหมด' : item.audience_values.length}</p><p className="text-[9px] uppercase text-muted">กลุ่มผู้รับ</p></div>
                    </div>
                    <p className="mt-3 text-[10px] text-muted">เริ่ม {formatDate(item.starts_at)} · {item.expires_at ? `สิ้นสุด ${formatDate(item.expires_at)}` : 'ไม่กำหนดวันสิ้นสุด'}</p>
                    <div className="mt-3 flex gap-2">
                      {item.status !== 'published' ? <button type="button" onClick={() => void runAction(item.id, 'publish')} className="rounded-full bg-ink px-3 py-2 text-[10px] font-semibold text-white">เผยแพร่</button> : <button type="button" onClick={() => void runAction(item.id, 'pause')} className="rounded-full border border-line px-3 py-2 text-[10px] font-semibold">หยุดชั่วคราว</button>}
                      {item.status !== 'cancelled' ? <button type="button" onClick={() => void runAction(item.id, 'cancel')} className="rounded-full px-3 py-2 text-[10px] font-semibold text-red-500">ยกเลิก</button> : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="mt-6 rounded-panel bg-ground px-5 py-10 text-center text-[13px] text-muted">ยังไม่มีประกาศ</p>}
          </section>
        </div>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</span>{children}</label>
}
