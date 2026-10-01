'use client'

import { useState } from 'react'
import { Download, Laptop, Monitor, Loader2 } from 'lucide-react'
import { CIIYA_SYNC_INSTALLERS } from '@/lib/ciiya-sync/installers'

export default function CiiyaSyncDownloads({ locale, enabled }: {
  locale: 'th' | 'en'
  enabled: boolean
}) {
  const th = locale === 'th'
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function download(id: string) {
    setBusy(id)
    setError('')
    try {
      const response = await fetch(`/api/ciiya-sync/download?platform=${id}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || typeof data.url !== 'string') throw new Error('DOWNLOAD_UNAVAILABLE')
      window.location.assign(data.url)
    } catch {
      setError(th
        ? 'ยังดาวน์โหลดไม่ได้ กรุณาลองอีกครั้ง หากออกจากระบบแล้วให้เข้าสู่ระบบใหม่'
        : 'Download unavailable. Please try again, or sign in again if your session expired.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="sync-download-heading" className="mt-4 rounded-[26px] border border-line bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sync-download-heading" className="text-[20px] font-semibold tracking-[-0.025em]">
          {th ? 'ดาวน์โหลด Ciiya Sync' : 'Download Ciiya Sync'}
        </h2>
        <span className="rounded-full bg-gold-soft px-2.5 py-1 text-[11px] text-gold-deep">
          V0.1.0 · {th ? 'เวอร์ชันทดสอบ' : 'Canary'}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-6 text-muted">
        {th ? 'ติดตั้งบนคอมพิวเตอร์ แล้วเชื่อมบัญชีเพื่อส่งภาพเข้าอัลบั้ม' : 'Install on your computer, then connect your account to upload to an album.'}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {CIIYA_SYNC_INSTALLERS.map((installer) => {
          const mac = installer.id === 'mac-arm64'
          const Icon = mac ? Laptop : Monitor
          return (
            <article key={installer.id} className="flex min-w-0 flex-col rounded-[20px] border border-line bg-ground/60 p-4">
              <div className="flex items-center gap-2.5">
                <Icon size={20} strokeWidth={1.6} aria-hidden />
                <h3 className="text-[16px] font-semibold">{mac ? 'Mac' : 'Windows'}</h3>
                <span className="ml-auto text-[11px] text-muted">{Math.round(installer.bytes / 1024 / 1024)} MB</span>
              </div>
              <p className="mt-3 text-[12px] leading-5 text-ink">
                {mac ? 'macOS 13 Ventura+' : 'Windows 10 / 11 (64-bit)'}
                <br />
                {mac ? 'Apple Silicon · M1, M2, M3, M4…' : 'Intel / AMD (x64) · ARM64'}
              </p>
              <p className="mb-4 mt-1 text-[11px] leading-5 text-muted">
                {mac
                  ? th ? 'ไฟล์นี้ใช้ไม่ได้กับ Mac ชิป Intel' : 'This installer does not support Intel Macs.'
                  : th ? 'ตัวติดตั้งเลือกสถาปัตยกรรมให้ · ไม่รองรับ 32-bit' : 'Installer selects architecture · No 32-bit support'}
              </p>
              <button type="button" onClick={() => download(installer.id)} disabled={!enabled || busy !== null}
                className="mt-auto inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink px-3 text-[13px] font-semibold text-white transition hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-45">
                {busy === installer.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Download size={16} aria-hidden />}
                {th ? 'ดาวน์โหลด' : 'Download'} {mac ? 'Mac (.dmg)' : 'Windows (.exe)'}
              </button>
            </article>
          )
        })}
      </div>
      {!enabled && <p className="mt-3 text-[12px] leading-5 text-muted">
        {th ? 'ขณะนี้เปิดให้เฉพาะบัญชีทดสอบที่ได้รับสิทธิ์ หรือระบบดาวน์โหลดยังไม่พร้อม' : 'Currently available to approved test accounts only, or downloads are temporarily unavailable.'}
      </p>}
      {error && <p role="alert" className="mt-3 text-[12px] leading-5 text-red-600">{error}</p>}
      <p className="mt-3 text-[11px] leading-5 text-muted">
        {th ? 'Build 1 ต.ค. 2026 · ยังไม่เซ็นดิจิทัล ระบบอาจแจ้งเตือนก่อนติดตั้ง · Windows ยังรอทดสอบบนเครื่องจริง' : 'Build Oct 1, 2026 · Unsigned: your system may show a warning · Native Windows testing pending'}
      </p>
      <details className="mt-3 border-t border-line pt-3 text-[12px] leading-6 text-muted">
        <summary className="cursor-pointer font-medium text-ink">{th ? 'วิธีติดตั้งและเริ่มใช้งาน' : 'Installation and getting started'}</summary>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          <li>{th ? 'Mac: เปิด .dmg แล้วลาก Ciiya Sync ไปที่ Applications หากระบบบล็อก ให้ไป System Settings → Privacy & Security → Open Anyway เฉพาะเมื่อมั่นใจว่าได้ไฟล์จาก Ciiya' : 'Mac: open the .dmg and drag Ciiya Sync to Applications. If blocked, use System Settings → Privacy & Security → Open Anyway only if you trust this Ciiya download.'}</li>
          <li>{th ? 'Windows: เปิด .exe แล้วทำตามขั้นตอน หาก SmartScreen แจ้งเตือน ให้ตรวจสอบที่มาของไฟล์ก่อนเลือก More info → Run anyway (หากเครื่องอนุญาต)' : 'Windows: open the .exe and follow setup. If SmartScreen warns, verify the source before choosing More info → Run anyway (if permitted on your computer).'}</li>
          <li>{th ? 'เปิดแอป → เชื่อมบัญชี → เลือกอัลบั้มและโฟลเดอร์ หากใช้ Export To ใน Lightroom Classic ให้ติดตั้งปลั๊กอินจากตั้งค่าเพิ่มเติมในแอป' : 'Open the app → connect your account → choose an album and folder. For Export To in Lightroom Classic, install the plugin from the app’s additional settings.'}</li>
        </ol>
        <p className="mt-2">{th ? 'ไม่ใช่แอปสำหรับ iPhone / iPad / Android · ปลั๊กอินใช้กับ Lightroom Classic บนคอมพิวเตอร์' : 'Not for iPhone / iPad / Android · Plugin requires desktop Lightroom Classic'}</p>
      </details>
    </section>
  )
}
