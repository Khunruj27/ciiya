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

export type AnnouncementNotification = {
  id: string
  announcementType: string
  title: string
  summary: string
  body: string | null
  imageUrl: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  priority: string
  createdAt: string
  readAt: string | null
}

type Filter = 'all' | 'activity' | 'news' | 'unread'
type CombinedItem =
  | { kind: 'activity'; createdAt: string; item: NotificationItem }
  | { kind: 'news'; createdAt: string; item: AnnouncementNotification }

function relativeTime(value: string) {
  const difference = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(difference / 60_000)
  if (minutes < 1) return 'เมื่อสักครู่'
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} วันที่แล้ว`
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(value))
}

function notificationCopy(item: NotificationItem) {
  const matches = Number(item.metadata.match_count || 0)
  const photoCount = Number(item.metadata.photo_count || 0)
  const guestName = String(item.metadata.guest_name || 'ผู้เข้าชม')
  if (item.eventType === 'album_view') return { eyebrow: 'การเข้าชมแกลเลอรี', title: `มีผู้เข้าชม ${item.albumTitle}` }
  if (item.eventType === 'photo_download') return { eyebrow: 'ดาวน์โหลด', title: `มีการดาวน์โหลดรูปจาก ${item.albumTitle}` }
  if (item.eventType === 'photo_like') return { eyebrow: 'หัวใจใหม่', title: `มีผู้กดถูกใจรูปใน ${item.albumTitle}` }
  if (item.eventType === 'moment_created') return { eyebrow: 'โมเมนต์จากแขก', title: `${guestName} แชร์รูป ${photoCount || 1} รูป` }
  if (item.eventType === 'moment_like') return { eyebrow: 'การตอบรับโมเมนต์', title: `มีผู้กดถูกใจโมเมนต์ใน ${item.albumTitle}` }
  if (item.eventType === 'face_search') {
    return {
      eyebrow: 'ค้นหาใบหน้า',
      title: matches > 0 ? `ผู้เข้าชมพบรูปของตนเอง ${matches} รูปใน ${item.albumTitle}` : `ผู้เข้าชมค้นหารูปของตนเองใน ${item.albumTitle}`,
    }
  }
  return { eyebrow: 'กิจกรรมแกลเลอรี', title: `มีกิจกรรมใหม่ใน ${item.albumTitle}` }
}

function announcementLabel(type: string) {
  if (type === 'feature') return 'ฟีเจอร์ใหม่'
  if (type === 'promotion') return 'โปรโมชัน'
  if (type === 'maintenance') return 'ประกาศการให้บริการ'
  if (type === 'tip') return 'เคล็ดลับจาก Ciiya'
  if (type === 'security') return 'ความปลอดภัย'
  return 'อัปเดต Ciiya'
}

export default function NotificationsList({
  initialItems,
  initialAnnouncements,
}: {
  initialItems: NotificationItem[]
  initialAnnouncements: AnnouncementNotification[]
}) {
  const [items, setItems] = useState(initialItems)
  const [announcements, setAnnouncements] = useState(initialAnnouncements)
  const [filter, setFilter] = useState<Filter>('all')
  const [marking, setMarking] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const unreadCount = items.filter((item) => !item.readAt).length + announcements.filter((item) => !item.readAt).length
  const visibleItems = useMemo(() => {
    const combined: CombinedItem[] = [
      ...items.map((item): CombinedItem => ({ kind: 'activity', createdAt: item.createdAt, item })),
      ...announcements.map((item): CombinedItem => ({ kind: 'news', createdAt: item.createdAt, item })),
    ]
    return combined
      .filter((entry) => {
        if (filter === 'activity') return entry.kind === 'activity'
        if (filter === 'news') return entry.kind === 'news'
        if (filter === 'unread') return !entry.item.readAt
        return true
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [announcements, filter, items])

  async function updateAnnouncementRead(id: string, clicked = false) {
    const now = new Date().toISOString()
    setAnnouncements((current) => current.map((item) => item.id === id ? { ...item, readAt: item.readAt || now } : item))
    await fetch('/api/notifications/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clicked ? { announcementIds: [id], clickedId: id } : { announcementIds: [id] }),
      keepalive: clicked,
    }).catch(() => {})
  }

  async function updateActivityRead(id: string) {
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: item.readAt || now } : item))
    await fetch('/api/notifications/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareEventIds: [id] }),
      keepalive: true,
    }).catch(() => {})
  }

  async function markAllRead() {
    if (!unreadCount || marking) return
    setMarking(true)
    const announcementIds = announcements.filter((item) => !item.readAt).map((item) => item.id)
    const response = await fetch('/api/notifications/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ announcementIds, markAllActivity: true }),
    })
    if (response.ok) {
      const now = new Date().toISOString()
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || now })))
      setAnnouncements((current) => current.map((item) => ({ ...item, readAt: item.readAt || now })))
    }
    setMarking(false)
  }

  function toggleAnnouncement(item: AnnouncementNotification) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
    if (!item.readAt) void updateAnnouncementRead(item.id)
  }

  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'activity', label: 'กิจกรรม' },
    { value: 'news', label: 'ข่าวสาร Ciiya' },
    { value: 'unread', label: unreadCount ? `ยังไม่อ่าน ${unreadCount}` : 'ยังไม่อ่าน' },
  ]

  return (
    <>
      <div className="mt-7 flex items-start justify-between gap-3">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1">
          {filters.map(({ value, label }) => (
            <button key={value} type="button" onClick={() => setFilter(value)} className={`shrink-0 rounded-full px-3.5 py-2 text-[11px] font-semibold transition ${filter === value ? 'bg-ink text-white' : 'text-muted'}`}>
              {label}
            </button>
          ))}
        </div>

        {unreadCount ? (
          <button type="button" onClick={markAllRead} disabled={marking} className="hidden h-10 shrink-0 items-center gap-2 rounded-full bg-ink px-4 text-[12px] font-semibold text-white transition active:scale-95 disabled:opacity-50 sm:inline-flex">
            <span aria-hidden>✓</span>{marking ? 'กำลังอัปเดต…' : 'อ่านทั้งหมด'}
          </button>
        ) : null}
      </div>

      {unreadCount ? (
        <button type="button" onClick={markAllRead} disabled={marking} className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[12px] font-semibold text-white disabled:opacity-50 sm:hidden">
          <span aria-hidden>✓</span>{marking ? 'กำลังอัปเดต…' : 'อ่านทั้งหมด'}
        </button>
      ) : null}

      {visibleItems.length ? (
        <div className="mt-5 space-y-3">
          {visibleItems.map((entry) => {
            if (entry.kind === 'activity') {
              const item = entry.item
              const copy = notificationCopy(item)
              return (
                <Link key={`activity-${item.id}`} href={`/albums/${item.albumId}/analytics`} onClick={() => { if (!item.readAt) void updateActivityRead(item.id) }} className={`flex gap-4 rounded-panel border border-line p-4 transition hover:bg-ground ${item.readAt ? 'bg-surface' : 'bg-gold-soft/45'}`}>
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-card bg-ground-sunken">
                    {item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="56px" unoptimized className="object-cover" /> : <div className="flex h-full items-center justify-center text-[20px] text-gold-deep">✦</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-deep">{copy.eyebrow}</p>{!item.readAt ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold" /> : null}</div>
                    <p className="mt-1 text-[14px] font-semibold leading-5">{copy.title}</p>
                    <p className="mt-1 text-[11px] text-muted">{relativeTime(item.createdAt)}</p>
                  </div>
                </Link>
              )
            }

            const item = entry.item
            const expanded = expandedIds.has(item.id)
            return (
              <article key={`news-${item.id}`} className={`overflow-hidden rounded-panel border ${item.priority === 'critical' ? 'border-rose/40' : item.priority === 'important' ? 'border-gold/60' : 'border-line'} ${item.readAt ? 'bg-surface' : 'bg-gold-soft/45'}`}>
                {item.imageUrl ? <div className="h-36 bg-cover bg-center" style={{ backgroundImage: `url("${item.imageUrl.replace(/["\\]/g, '')}")` }} /> : null}
                <button type="button" onClick={() => toggleAnnouncement(item)} aria-expanded={expanded} className="flex w-full gap-4 p-4 text-left">
                  <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-card text-[22px] ${item.announcementType === 'promotion' ? 'bg-rose/10 text-rose' : 'bg-gold-soft text-gold-deep'}`}>
                    {item.announcementType === 'promotion' ? '%' : item.announcementType === 'security' ? '◇' : '✦'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-deep">{announcementLabel(item.announcementType)}</p>{!item.readAt ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold" /> : null}</div>
                    <h2 className="mt-1 text-[15px] font-semibold leading-5">{item.title}</h2>
                    <p className="mt-1 text-[12px] leading-5 text-muted">{item.summary}</p>
                    <p className="mt-2 text-[10px] text-muted">{relativeTime(item.createdAt)} · {expanded ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}</p>
                  </div>
                </button>

                {expanded ? (
                  <div className="border-t border-line px-4 pb-4 pt-4 sm:pl-[88px]">
                    {item.body ? <p className="whitespace-pre-line text-[13px] leading-6 text-ink-soft">{item.body}</p> : null}
                    {item.ctaUrl ? (
                      <a href={item.ctaUrl} onClick={() => void updateAnnouncementRead(item.id, true)} className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-ink px-5 text-[12px] font-semibold text-white">
                        {item.ctaLabel || 'ดูเพิ่มเติม'}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-hero border border-line bg-surface px-6 py-14 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold-soft text-[26px] text-gold-deep">♢</div>
          <h2 className="mt-5 text-[20px] font-semibold">{filter === 'unread' ? 'อ่านครบทั้งหมดแล้ว' : 'ยังไม่มีการแจ้งเตือน'}</h2>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-6 text-muted">กิจกรรมจากแกลเลอรีและข่าวสารจาก Ciiya จะแสดงที่นี่</p>
        </div>
      )}
    </>
  )
}
