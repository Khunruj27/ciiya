'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const refreshSequence = useRef(0)

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current
    try {
      const res = await fetch('/api/notifications/count', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      // Do not let a slower, older request overwrite a newer count.
      if (sequence === refreshSequence.current) {
        setCount(Math.max(0, Number(data?.count || 0)))
      }
    } catch {
      // keep the last known count on a transient failure
    }
  }, [])

  useEffect(() => {
    if (!userId) return

    const initialRefresh = window.setTimeout(refresh, 0)

    // The Supabase client is created here (client-only), never during render.
    const supabase = createClient()
    let cancelled = false

    /*
     * The channel and its callbacks are built synchronously: `postgres_changes`
     * callbacks can only be added before `subscribe()`, and a unique topic name
     * keeps StrictMode's double-mount (dev) from handing back a stale channel
     * that was already subscribed. Only the auth + subscribe step is deferred.
     */
    const channel = supabase
      .channel(`notifications:${userId}:${Math.random().toString(36).slice(2)}`)
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => refresh()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcement_reads',
          filter: `user_id=eq.${userId}`,
        },
        () => refresh()
      )

    ;(async () => {
      // share_events is owner-only under RLS, so the realtime socket must carry
      // the user's token or the server sends no changes.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return
      if (session?.access_token) supabase.realtime.setAuth(session.access_token)
      channel.subscribe((status) => {
        // Close the small gap between the initial HTTP request and a working
        // realtime socket: an event created during that gap is fetched here.
        if (status === 'SUBSCRIBED') void refresh()
      })
    })()

    // Poll backs up realtime if the socket drops or is blocked.
    const poll = window.setInterval(refresh, 10000)

    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onPageShow = () => void refresh()

    document.addEventListener('visibilitychange', refreshWhenActive)
    window.addEventListener('focus', refreshWhenActive)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', refreshWhenActive)

    return () => {
      cancelled = true
      window.clearTimeout(initialRefresh)
      supabase.removeChannel(channel)
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', refreshWhenActive)
      window.removeEventListener('focus', refreshWhenActive)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', refreshWhenActive)
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
        <span
          data-notification-count={count}
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-surface bg-[#B95757] px-1 text-[9px] font-semibold leading-none text-white shadow-sm"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  )
}
