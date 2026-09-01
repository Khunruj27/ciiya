'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  getDictionary,
  type Locale,
} from '@/lib/i18n'

/**
 * The app-language switch that lives on the Me page. Writing the cookie and
 * refreshing re-runs the server render in the new language, so every server
 * component updates at once. Seeded from the server-resolved `current` so the
 * active choice is correct on first paint.
 */
export default function LanguageToggle({ current }: { current: Locale }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const t = getDictionary(current)

  function choose(locale: Locale) {
    if (locale === current) return
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`
    startTransition(() => router.refresh())
  }

  const label: Record<Locale, string> = {
    th: t.common.thai,
    en: t.common.english,
  }

  return (
    <section className="mt-3 flex items-center justify-between gap-4 rounded-panel border border-line bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-ink">{t.common.language}</p>
        <p className="mt-0.5 text-[12px] font-normal text-muted">
          {t.me.languageHint}
        </p>
      </div>

      <div
        className={`inline-flex shrink-0 rounded-full border border-line bg-ground p-1 ${
          pending ? 'opacity-60' : ''
        }`}
      >
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            onClick={() => choose(locale)}
            aria-pressed={locale === current}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
              locale === current ? 'bg-ink text-white' : 'text-muted'
            }`}
          >
            {label[locale]}
          </button>
        ))}
      </div>
    </section>
  )
}
