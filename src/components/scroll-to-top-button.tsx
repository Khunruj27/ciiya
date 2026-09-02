'use client'

import { useEffect, useState } from 'react'
import { useI18n } from '@/components/i18n-provider'

export default function ScrollToTopButton() {
  const { t } = useI18n()
  // Seeded lazily (client-only) so the initial value is read without a
  // synchronous setState inside an effect; the listener updates it after.
  const [visible, setVisible] = useState(
    () => typeof window !== 'undefined' && window.scrollY > 300
  )

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 300)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    // Sits on the right, tucked just under the floating face-search button
    // (which is at bottom = 1.25rem + 15vh, and is 3.5rem tall).
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label={t.common.backToTop}
      title={t.common.backToTop}
      className="group fixed bottom-[calc(15vh-2.25rem)] right-4 z-50 flex h-11 items-center gap-2 rounded-full border border-line bg-surface/90 px-4 text-[13px] font-semibold text-ink shadow-lift backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:text-gold-deep hover:shadow-float active:scale-95"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-[18px] w-[18px] transition-transform duration-200 group-hover:-translate-y-0.5"
      >
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
      {t.common.backToTop}
    </button>
  )
}
