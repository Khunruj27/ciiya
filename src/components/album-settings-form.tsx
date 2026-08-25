'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type DownloadSize = 'sd' | 'hd' | 'uhd' | 'original'

type Props = {
  albumId: string
  initialTitle: string
  initialDescription: string | null
  initialAllowDownload: boolean
  initialDownloadSize: DownloadSize
  initialIsPasswordProtected: boolean
}

const downloadSizeOptions: {
  value: DownloadSize
  label: string
  desc: string
}[] = [
  { value: 'sd', label: 'SD', desc: '2000px ประหยัดพื้นที่และ bandwidth มากที่สุด' },
  { value: 'hd', label: 'HD', desc: '3000px แนะนำสำหรับส่งลูกค้าทั่วไป' },
  { value: 'uhd', label: 'UHD', desc: '4000px คุณภาพสูงกว่า แต่ใช้ bandwidth มากขึ้น' },
  { value: 'original', label: 'Original', desc: 'ไฟล์ต้นฉบับ ใช้ storage/egress สูงสุด' },
]

function normalizeDownloadSize(value: string | null | undefined): DownloadSize {
  if (value === 'sd' || value === 'uhd' || value === 'original') return value
  return 'hd'
}

export default function AlbumSettingsForm({
  albumId,
  initialTitle,
  initialDescription,
  initialAllowDownload,
  initialDownloadSize,
  initialIsPasswordProtected,
}: Props) {
  const router = useRouter()

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription || '')
  const [allowDownload, setAllowDownload] = useState(initialAllowDownload)
  const [downloadSize, setDownloadSize] = useState<DownloadSize>(
    normalizeDownloadSize(initialDownloadSize)
  )
  const [isPasswordProtected, setIsPasswordProtected] = useState(
    initialIsPasswordProtected
  )
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (!title.trim()) {
      setErrorMsg('Title is required')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/albums/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          albumId,
          title: title.trim(),
          description: description.trim(),
          allowDownload,
          downloadSize,
          isPasswordProtected,
          password,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save settings')
      }

      setSuccessMsg('Album settings updated successfully')
      setPassword('')
      router.refresh()
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : 'Failed to save settings'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-3xl bg-white p-4 shadow-sm"
    >
      <div>
        <h2 className="text-lg font-semibold text-ink">ตั้งค่าอัลบั้ม</h2>
        <p className="text-sm text-muted">
          จัดการข้อมูล ความเป็นส่วนตัว และตัวเลือกดาวน์โหลด
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm text-muted">ชื่ออัลบั้ม</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-2xl border border-line px-4 py-3 outline-none"
          placeholder="ชื่ออัลบั้ม"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-muted">คำอธิบาย</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[110px] w-full rounded-2xl border border-line px-4 py-3 outline-none"
          placeholder="คำอธิบายอัลบั้ม"
        />
      </div>

      <div className="space-y-4 rounded-2xl border border-line p-4">
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">อนุญาตให้ดาวน์โหลด</p>
            <p className="text-xs text-muted">
              ให้ลูกค้าบันทึกรูปจากหน้าแชร์ได้
            </p>
          </div>

          <input
            type="checkbox"
            checked={allowDownload}
            onChange={(e) => setAllowDownload(e.target.checked)}
            className="h-5 w-5"
          />
        </label>

        {allowDownload ? (
          <div className="space-y-3 border-t border-line pt-4">
            <div>
              <p className="text-sm font-medium text-ink">
                ขนาดไฟล์ดาวน์โหลด
              </p>
              <p className="text-xs text-muted">
                หน้าแชร์จะโหลดตามขนาดนี้เท่านั้น ลูกค้าเลือกขนาดเองไม่ได้
              </p>
            </div>

            <div className="grid gap-2">
              {downloadSizeOptions.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
                    downloadSize === option.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-line bg-white hover:bg-ground-sunken'
                  }`}
                >
                  <input
                    type="radio"
                    name="downloadSize"
                    value={option.value}
                    checked={downloadSize === option.value}
                    onChange={() => setDownloadSize(option.value)}
                    className="mt-1 h-4 w-4"
                  />

                  <span>
                    <span className="block text-sm font-semibold text-ink">
                      {option.label}
                    </span>
                    <span className="block text-xs text-muted">
                      {option.desc}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-2xl border border-line p-4">
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">
              ป้องกันด้วยรหัสผ่าน
            </p>
            <p className="text-xs text-muted">
              ต้องใส่รหัสผ่านก่อนเปิดดูอัลบั้ม
            </p>
          </div>

          <input
            type="checkbox"
            checked={isPasswordProtected}
            onChange={(e) => setIsPasswordProtected(e.target.checked)}
            className="h-5 w-5"
          />
        </label>

        {isPasswordProtected ? (
          <div>
            <label className="mb-2 block text-sm text-muted">
              รหัสผ่านใหม่
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-line px-4 py-3 outline-none"
              placeholder="เว้นว่างเพื่อใช้รหัสผ่านเดิม"
            />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => history.back()}
          className="rounded-2xl bg-ground-sunken px-4 py-3 text-center text-ink-soft"
        >
          ย้อนกลับ
        </button>

        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl bg-blue-600 px-4 py-3 text-white disabled:opacity-50"
        >
          {loading ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}
        </button>
      </div>

      {errorMsg ? <p className="text-sm text-red-500">{errorMsg}</p> : null}
      {successMsg ? (
        <p className="text-sm text-green-600">{successMsg}</p>
      ) : null}
    </form>
  )
}
