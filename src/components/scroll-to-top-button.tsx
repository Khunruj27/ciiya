'use client'

import { useEffect, useState } from 'react'
import AppIcon from '@/components/app-icon'

export default function ScrollToTopButton() {
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
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      title="Back to top"
      className="group fixed bottom-6 left-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface/85 text-ink shadow-lift backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:text-gold-deep hover:shadow-float active:scale-95"
    >
      <AppIcon
        name="arrow-top"
        size={20}
        className="transition-transform duration-200 group-hover:-translate-y-0.5"
      />
    </button>
  )
}
