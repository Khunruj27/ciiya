'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

export type NotificationItem = {
  id: string
  albumId: string
  albumTitle: string
  eventType: string
  createdAt: string
  readAt: string | null
  imageUrl: string | null
  metadata: Record<string, unknown>
}

function relativeTime(value: string) {
  const difference = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(difference / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(
    new Date(value)
  )
}

function notificationCopy(item: NotificationItem) {
  const matches = Number(item.metadata.match_count || 0)
  const photoCount = Number(item.metadata.photo_count || 0)
  const guestName = String(item.metadata.guest_name || 'A guest')

  if (item.eventType === 'album_view') {
    return { eyebrow: 'Gallery view', title: `Someone opened ${item.albumTitle}` }
  }
  if (item.eventType === 'photo_download') {
    return { eyebrow: 'Download', title: `A photo from ${item.albumTitle} was downloaded` }
  }
  if (item.eventType === 'photo_like') {
    return { eyebrow: 'New heart', title: `A guest liked a photo in ${item.albumTitle}` }
  }
  if (item.eventType === 'moment_created') {
    return {
      eyebrow: 'Guest moment',
      title: `${guestName} shared ${photoCount || 1} photo${photoCount === 1 ? '' : 's'}`,
    }
  }
  if (item.eventType === 'moment_like') {
    return { eyebrow: 'Moment reaction', title: `A guest liked a moment in ${item.albumTitle}` }
  }
  if (item.eventType === 'face_search') {
    return {
      eyebrow: 'Face search',
      title: matches > 0
        ? `A guest found ${matches} photo${matches === 1 ? '' : 's'} in ${item.albumTitle}`
        : `A guest searched for their photos in ${item.albumTitle}`,
    }
  }
  return { eyebrow: 'Gallery activity', title: `New activity in ${item.albumTitle}` }
}

export default function NotificationsList({
  initialItems,
}: {
  initialItems: NotificationItem[]
}) {
  const [items, setItems] = useState(initialItems)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [marking, setMarking] = useState(false)

  const unreadCount = items.filter((item) => !item.readAt).length
  const visibleItems = useMemo(
    () => (filter === 'unread' ? items.filter((item) => !item.readAt) : items),
    [filter, items]
  )

  async function markAllRead() {
    if (!unreadCount || marking) return
    setMarking(true)

    const response = await fetch('/api/notifications/read', { method: 'PATCH' })
    if (response.ok) {
      const now = new Date().toISOString()
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || now })))
    }

    setMarking(false)
  }

  return (
    <>
      <div className="mt-7 flex items-center justify-between gap-4">
        <div className="inline-flex rounded-full border border-line bg-surface p-1">
          {(['all', 'unread'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-full px-4 py-2 text-[12px] font-semibold capitalize transition ${
                filter === value ? 'bg-ink text-white' : 'text-muted'
              }`}
            >
              {value}{value === 'unread' && unreadCount ? ` ${unreadCount}` : ''}
            </button>
          ))}
        </div>

        {unreadCount ? (
          <button
            type="button"
            onClick={markAllRead}
            disabled={marking}
            className="text-[12px] font-semibold text-gold-deep disabled:opacity-50"
          >
            {marking ? 'Updating…' : 'Mark all read'}
          </button>
        ) : null}
      </div>

      {visibleItems.length ? (
        <div className="mt-5 overflow-hidden rounded-hero border border-line bg-surface">
          {visibleItems.map((item, index) => {
            const copy = notificationCopy(item)
            return (
              <Link
                key={item.id}
                href={`/albums/${item.albumId}/analytics`}
                className={`flex gap-4 p-4 transition hover:bg-ground ${
                  index ? 'border-t border-line' : ''
                } ${item.readAt ? '' : 'bg-gold-soft/45'}`}
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-card bg-ground-sunken">
                  {item.imageUrl ? (
                    <Image src={item.imageUrl} alt="" fill sizes="56px" unoptimized className="object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[20px] text-gold-deep">✦</div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-deep">
                      {copy.eyebrow}
                    </p>
                    {!item.readAt ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold" /> : null}
                  </div>
                  <p className="mt-1 text-[14px] font-semibold leading-5 text-ink">{copy.title}</p>
                  <p className="mt-1 text-[11px] text-muted">{relativeTime(item.createdAt)}</p>
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-hero border border-line bg-surface px-6 py-14 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold-soft text-[26px] text-gold-deep">♢</div>
          <h2 className="mt-5 text-[20px] font-semibold text-ink">
            {filter === 'unread' ? 'You’re all caught up' : 'No gallery activity yet'}
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-6 text-muted">
            Views, downloads, hearts, face searches, and guest moments will appear here.
          </p>
        </div>
      )}
    </>
  )
}

