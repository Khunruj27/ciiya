'use client'

import Link from 'next/link'
import { Camera, ArrowUpRight } from 'lucide-react'
import { useI18n } from '@/components/i18n-provider'

export default function AlbumCameraSync({ albumTitle }: { albumTitle?: string }) {
  const { t } = useI18n()

  return (
    <section aria-labelledby="camera-sync-heading" className="pt-4">
      <div className="rounded-panel border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold-soft text-gold-deep" aria-hidden>
            <Camera size={17} strokeWidth={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="camera-sync-heading" className="text-[13px] font-medium text-ink">{t.cameraStatus.syncHeading}</h2>
            <p className="mt-1 text-[12px] leading-5 text-muted">{t.cameraStatus.syncDescription}</p>
          </div>
          <Link href="/me/ciiya-sync" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-[12px] font-medium text-white transition hover:bg-ink-soft">
            {t.cameraStatus.syncSetup}
            <ArrowUpRight size={14} aria-hidden />
          </Link>
        </div>
        <details className="mt-3 border-t border-line pt-3 text-[12px] leading-6 text-muted">
          <summary className="cursor-pointer font-medium text-ink">{t.cameraStatus.syncInstructions}</summary>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>{t.cameraStatus.syncCameraStep}</li>
            <li>{t.cameraStatus.syncAlbumStep(albumTitle || t.cameraStatus.syncCurrentAlbum)}</li>
            <li>{t.cameraStatus.syncStartStep}</li>
          </ol>
          <p className="mt-3">{t.cameraStatus.syncExportStep}</p>
        </details>
      </div>
    </section>
  )
}
