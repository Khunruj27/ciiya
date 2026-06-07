'use client'

import { useEffect, useState } from 'react'
import AppIcon from '@/components/app-icon'

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 300)
    }

    window.addEventListener('scroll', onScroll)
    onScroll()

    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      onClick={() =>
        window.scrollTo({
          top: 0,
          behavior: 'smooth',
        })
      }
      className="
        fixed
        bottom-50
        right-4
        z-50
        flex
        flex-col
        items-center
        justify-center
        h-16
        w-16
        rounded-full
        bg-[#F0B1DE]
        transition
        active:scale-95
      "
      title="Back to top"
    >
     <AppIcon name="arrow-top" size={26} className="opacity-100" />
    </button>
  )
}