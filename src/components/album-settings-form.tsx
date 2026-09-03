'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n-provider'

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
  { value: 'sd', label: 'SD', desc: '2000px · Saves the most space and bandwidth' },
  { value: 'hd', label: 'HD', desc: '3000px · Recommended for most client deliveries' },
  { value: 'uhd', label: 'UHD', desc: '4000px · Higher quality, uses more bandwidth' },
  { value: 'original', label: 'Original', desc: 'Original files · Uses the most storage and egress' },
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
  const { t } = useI18n()
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
      setErrorMsg(t.albumSettings.titleRequired)
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
        throw new Error(data?.error || t.albumSettings.saveFailed)
      }

      setSuccessMsg(t.albumSettings.saveSuccess)
      setPassword('')
      router.refresh()
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : t.albumSettings.saveFailed
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
        <h2 className="text-lg font-semibold text-ink">{t.albumSettings.heading}</h2>
        <p className="text-sm text-muted">
          {t.albumSettings.subtitle}
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm text-muted">{t.albumSettings.nameLabel}</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-2xl border border-line px-4 py-3 outline-none"
          placeholder={t.albumSettings.namePlaceholder}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-muted">{t.albumSettings.descLabel}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[110px] w-full rounded-2xl border border-line px-4 py-3 outline-none"
          placeholder={t.albumSettings.descPlaceholder}
        />
      </div>

      <div className="space-y-4 rounded-2xl border border-line p-4">
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">{t.albumSettings.allowDownloads}</p>
            <p className="text-xs text-muted">
              {t.albumSettings.allowDownloadsDesc}
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
                {t.albumSettings.downloadSize}
              </p>
              <p className="text-xs text-muted">
                {t.albumSettings.downloadSizeDesc}
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
                      {t.albumSettings.sizeDesc(option.value)}
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
              {t.albumSettings.passwordProtection}
            </p>
            <p className="text-xs text-muted">
              {t.albumSettings.passwordProtectionDesc}
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
              {t.albumSettings.newPassword}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-line px-4 py-3 outline-none"
              placeholder={t.albumSettings.passwordPlaceholder}
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
          {t.albumSettings.back}
        </button>

        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl bg-blue-600 px-4 py-3 text-white disabled:opacity-50"
        >
          {loading ? t.albumSettings.saving : t.albumSettings.save}
        </button>
      </div>

      {errorMsg ? <p className="text-sm text-red-500">{errorMsg}</p> : null}
      {successMsg ? (
        <p className="text-sm text-green-600">{successMsg}</p>
      ) : null}
    </form>
  )
}
