'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { LOCALES, persistLocale, type Locale } from '@/lib/i18n'

/**
 * Compact TH/EN switch for public headers (landing, auth pages) where there is
 * no Me page to reach the full LanguageToggle. Writes the locale cookie and
 * refreshes so server components re-render in the chosen language.
 */
export default function LanguageSwitch({
  current,
  className = '',
}: {
  current: Locale
  className?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const shortLabel: Record<Locale, string> = { th: 'ไทย', en: 'EN' }

  function choose(locale: Locale) {
    if (locale === current) return
    persistLocale(locale)
    startTransition(() => router.refresh())
  }

  return (
    <div
      aria-label="Language"
      className={`inline-flex shrink-0 items-center rounded-full border border-line bg-white/70 p-0.5 text-[11px] font-semibold backdrop-blur ${
        pending ? 'opacity-60' : ''
      } ${className}`}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => choose(locale)}
          aria-pressed={locale === current}
          className={`rounded-full px-2.5 py-1.5 transition ${
            locale === current ? 'bg-ink text-white' : 'text-muted hover:text-ink'
          }`}
        >
          {shortLabel[locale]}
        </button>
      ))}
    </div>
  )
}
