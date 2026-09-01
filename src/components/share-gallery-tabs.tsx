'use client'

import { useEffect, useState, type ReactNode } from 'react'
import GuestMoments from '@/components/guest-moments'
import { useI18n } from '@/components/i18n-provider'

type Props = {
  token: string
  children: ReactNode
  // The photographer's contact card. When provided it becomes a third tab
  // ("Contact") alongside Gallery and Moments; when absent the tab is hidden.
  contact?: ReactNode
  // Total gallery hearts at first paint; kept live via the 'ciiya-photo-like'
  // window event the gallery dispatches when a guest reacts to a photo.
  initialGalleryLikes?: number
  // Published guest-moment count at first paint, so the Moments badge is
  // right before the tab (which loads the feed) is ever opened.
  initialMomentCount?: number
}

type Tab = 'gallery' | 'moments' | 'contact'

export default function ShareGalleryTabs({
  token,
  children,
  contact,
  initialGalleryLikes = 0,
  initialMomentCount = 0,
}: Props) {
  // A #moment- deep link opens straight into the Moments tab. Read lazily
  // (client-only) rather than in an effect, keeping the setState out of a
  // cascading effect body.
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    typeof window !== 'undefined' &&
    window.location.hash.startsWith('#moment-')
      ? 'moments'
      : 'gallery'
  )
  // Seeded from the server; GuestMoments refines it once its feed loads (e.g.
  // after a new post), via onCountChange.
  const [momentCount, setMomentCount] = useState(initialMomentCount)
  const { t } = useI18n()
  const [galleryLikes, setGalleryLikes] = useState(initialGalleryLikes)

  useEffect(() => {
    function onLike(event: Event) {
      const delta = Number((event as CustomEvent).detail?.delta || 0)
      if (delta) setGalleryLikes((current) => Math.max(0, current + delta))
    }
    window.addEventListener('ciiya-photo-like', onLike)
    return () => window.removeEventListener('ciiya-photo-like', onLike)
  }, [])

  function tabClass(tab: Tab, extra = '') {
    return `rounded-full px-4 py-2.5 text-[12px] font-semibold transition ${extra} ${
      activeTab === tab ? 'bg-ink text-white' : 'text-muted hover:text-ink'
    }`
  }

  return (
    <div className="space-y-5">
      <nav
        className="sticky top-3 z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-full border border-line bg-surface/90 p-1.5 shadow-lift backdrop-blur-xl"
        aria-label="Shared album sections"
      >
        <button
          type="button"
          onClick={() => setActiveTab('gallery')}
          aria-pressed={activeTab === 'gallery'}
          className={tabClass('gallery', 'flex shrink-0 items-center justify-center gap-2')}
        >
          {t.share.tabGallery}
          {galleryLikes > 0 ? (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                activeTab === 'gallery'
                  ? 'bg-white/15 text-white'
                  : 'bg-gold-soft text-gold-deep'
              }`}
            >
              {galleryLikes}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('moments')}
          aria-pressed={activeTab === 'moments'}
          className={tabClass('moments', 'flex shrink-0 items-center justify-center gap-2')}
        >
          {t.share.tabMoments}
          {momentCount > 0 ? (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                activeTab === 'moments'
                  ? 'bg-white/15 text-white'
                  : 'bg-gold-soft text-gold-deep'
              }`}
            >
              {momentCount}
            </span>
          ) : null}
        </button>

        {contact ? (
          <button
            type="button"
            onClick={() => setActiveTab('contact')}
            aria-pressed={activeTab === 'contact'}
            className={tabClass('contact', 'shrink-0 whitespace-nowrap')}
          >
            {t.share.tabContact}
          </button>
        ) : null}
      </nav>

      <div className={activeTab === 'gallery' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'gallery'}>
        {children}
      </div>

      <div className={activeTab === 'moments' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'moments'}>
        <GuestMoments token={token} active={activeTab === 'moments'} onCountChange={setMomentCount} />
      </div>

      {contact ? (
        <div className={activeTab === 'contact' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'contact'}>
          {contact}
        </div>
      ) : null}
    </div>
  )
}
