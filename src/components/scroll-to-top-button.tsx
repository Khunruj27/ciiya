'use client'

import { useEffect, useState } from 'react'
import AppIcon from '@/components/app-icon'
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
      <AppIcon
        name="arrow-top"
        size={18}
        className="transition-transform duration-200 group-hover:-translate-y-0.5"
      />
      {t.common.backToTop}
    </button>
  )
}
