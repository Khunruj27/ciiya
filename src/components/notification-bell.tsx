'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import AppIcon from '@/components/app-icon'

/*
 * Bottom-nav notification bell with a live unread badge. It seeds from the
 * server count (no flash), then keeps itself current three ways: a Supabase
 * realtime subscription on the owner's share_events rows, a short poll, and a
 * refetch when the tab regains focus. The count is always read back from the
 * server route (cookie-authenticated), so the number is the owner's own total.
 */
export default function NotificationBell({
  userId,
  initialCount = 0,
  active = false,
  size = 20,
}: {
  userId: string
  initialCount?: number
  active?: boolean
  size?: number
}) {
  const [count, setCount] = useState(initialCount)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/count', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setCount(Number(data?.count || 0))
    } catch {
      // keep the last known count on a transient failure
    }
  }, [])

  useEffect(() => {
    if (!userId) return

    refresh()

    // The Supabase client is created here (client-only), never during render.
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    ;(async () => {
      // share_events is owner-only under RLS, so the realtime socket must carry
      // the user's token or the server sends no changes.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.access_token) supabase.realtime.setAuth(session.access_token)

      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'share_events',
            filter: `owner_id=eq.${userId}`,
          },
          () => refresh()
        )
        .subscribe()
    })()

    // Poll backs up realtime if the socket drops or is blocked.
    const poll = window.setInterval(refresh, 20000)

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (channel) supabase.removeChannel(channel)
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, refresh])

  return (
    <Link
      href="/notifications"
      aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
      className={`relative flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
        active ? 'bg-gold-soft text-gold-deep' : 'text-muted'
      }`}
    >
      <AppIcon name="bell" size={size} />
      {count > 0 ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[8px] font-semibold leading-none text-ink">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  )
}
