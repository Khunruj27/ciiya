'use client'

import { useEffect, useState, type ReactNode } from 'react'
import GuestMoments from '@/components/guest-moments'

type Props = {
  token: string
  children: ReactNode
}

export default function ShareGalleryTabs({ token, children }: Props) {
  const [activeTab, setActiveTab] = useState<'gallery' | 'moments'>('gallery')
  const [momentCount, setMomentCount] = useState(0)

  useEffect(() => {
    if (window.location.hash.startsWith('#moment-')) setActiveTab('moments')
  }, [])

  return (
    <div className="space-y-5">
      <nav className="sticky top-3 z-40 mx-auto flex w-fit items-center rounded-full border border-line bg-surface/90 p-1.5 shadow-lift backdrop-blur-xl" aria-label="Shared album sections">
        <button type="button" onClick={() => setActiveTab('gallery')} aria-pressed={activeTab === 'gallery'} className={`min-w-28 rounded-full px-5 py-2.5 text-[12px] font-semibold transition ${activeTab === 'gallery' ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>Gallery</button>
        <button type="button" onClick={() => setActiveTab('moments')} aria-pressed={activeTab === 'moments'} className={`flex min-w-28 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-semibold transition ${activeTab === 'moments' ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>Moments {momentCount > 0 ? <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeTab === 'moments' ? 'bg-white/15 text-white' : 'bg-gold-soft text-gold-deep'}`}>{momentCount}</span> : null}</button>
      </nav>

      <div className={activeTab === 'gallery' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'gallery'}>{children}</div>
      <div className={activeTab === 'moments' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'moments'}>
        <GuestMoments token={token} active={activeTab === 'moments'} onCountChange={setMomentCount} />
      </div>
    </div>
  )
}
