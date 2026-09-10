'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw, Sparkles } from 'lucide-react'

type Insight = {
  generatedAt: string
  summary: string
  health: string
  highlights: string[]
  recommendations: Array<{
    id: string
    priority: 'high' | 'medium' | 'low'
    title: string
    detail: string
    actionLabel?: string
    actionHref?: string
  }>
  notificationDraft: { title: string; summary: string } | null
  privacy: string
}

type Props = {
  albumId: string
}

function resolveActionHref(albumId: string, href?: string) {
  if (!href || href.startsWith('#')) return `/albums/${albumId}`
  if (href.startsWith('/')) return href
  return `/albums/${albumId}/${href}`
}

export default function AiAlbumInsights({ albumId }: Props) {
  const [insight, setInsight] = useState<Insight | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true

    fetch(`/api/ai/albums/${albumId}/insights`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (active && data?.insight) setInsight(data.insight)
      })
      .catch(() => {
        // A missing previous analysis is non-blocking; the owner can create one.
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [albumId])

  async function generate() {
    setGenerating(true)
    setError('')
    try {
      const response = await fetch(`/api/ai/albums/${albumId}/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: Boolean(insight) }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.insight) {
        throw new Error(data?.error || 'วิเคราะห์แกลเลอรีไม่สำเร็จ')
      }
      setInsight(data.insight)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'วิเคราะห์แกลเลอรีไม่สำเร็จ')
    } finally {
      setGenerating(false)
    }
  }

  async function copyNotification() {
    if (!insight?.notificationDraft) return
    const text = `${insight.notificationDraft.title}\n${insight.notificationDraft.summary}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('คัดลอกข้อความไม่สำเร็จ')
    }
  }

  return (
    <section className="mt-6 overflow-hidden rounded-hero border border-[#d8c28f] bg-[#171717] text-white shadow-card">
      <div className="border-b border-white/10 px-5 py-5 sm:px-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#c7a86b] text-[#171717]">
              <Sparkles size={18} strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d9c28e]">Ciiya AI · Gallery Assistant</p>
              <h2 className="mt-1 text-[21px] font-semibold tracking-[-0.025em]">ผู้ช่วยวิเคราะห์แกลเลอรี</h2>
              <p className="mt-1 text-[12px] leading-5 text-white/55">สรุปข้อมูลและแนะนำสิ่งที่ควรทำต่อ โดยไม่แก้ไขงานแทนคุณ</p>
            </div>
          </div>
          {insight ? (
            <span className="shrink-0 rounded-full border border-[#c7a86b]/35 bg-[#c7a86b]/10 px-3 py-1.5 text-[10px] font-semibold text-[#e2cd9d]">
              {insight.health}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-9 text-center text-[13px] text-white/55">กำลังโหลดผลวิเคราะห์ล่าสุด…</div>
      ) : insight ? (
        <div className="space-y-6 px-5 py-6 sm:px-7">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#d9c28e]">ภาพรวม</p>
            <p className="mt-2 text-[16px] leading-7 text-white/90">{insight.summary}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-panel border border-white/10 bg-white/[0.045] p-4">
              <p className="text-[11px] font-semibold text-white/45">สิ่งที่ระบบสังเกตพบ</p>
              <ul className="mt-3 space-y-3">
                {insight.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-2.5 text-[13px] leading-5 text-white/75">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c7a86b]" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2.5">
              {insight.recommendations.map((item, index) => (
                <article key={item.id} className="rounded-panel border border-white/10 bg-white/[0.045] p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/8 text-[11px] font-semibold text-[#d9c28e]">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold">{item.title}</p>
                      <p className="mt-1 text-[12px] leading-5 text-white/55">{item.detail}</p>
                      {item.actionLabel ? (
                        <Link href={resolveActionHref(albumId, item.actionHref)} className="mt-3 inline-flex text-[11px] font-semibold text-[#dfc78f] underline decoration-[#dfc78f]/35 underline-offset-4">
                          {item.actionLabel}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {insight.notificationDraft ? (
            <div className="rounded-panel border border-[#c7a86b]/25 bg-[#c7a86b]/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d9c28e]">ร่างข้อความแจ้งลูกค้า</p>
                  <p className="mt-2 text-[14px] font-semibold">{insight.notificationDraft.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-white/60">{insight.notificationDraft.summary}</p>
                </div>
                <button type="button" onClick={copyNotification} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/75 transition hover:bg-white/10" aria-label="คัดลอกร่างข้อความ">
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-[10px] leading-4 text-white/35">{insight.privacy}</p>
            <button type="button" onClick={generate} disabled={generating} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[12px] border border-white/15 px-4 text-[12px] font-semibold text-white/80 transition hover:bg-white/8 disabled:cursor-wait disabled:opacity-50">
              <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
              {generating ? 'กำลังวิเคราะห์…' : 'วิเคราะห์ใหม่'}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-8 text-center sm:px-7">
          <p className="text-[16px] font-semibold">ให้ AI ช่วยอ่านภาพรวมของงานนี้</p>
          <p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-white/50">ระบบจะดูยอดเข้าชม การดาวน์โหลด หัวใจ การค้นหาใบหน้า และโมเมนต์จากแขก เพื่อสรุปสิ่งที่ควรทำต่อ</p>
          <button type="button" onClick={generate} disabled={generating} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-[13px] bg-[#c7a86b] px-5 text-[13px] font-semibold text-[#171717] transition hover:bg-[#d1b77e] disabled:cursor-wait disabled:opacity-60">
            <Sparkles size={16} />
            {generating ? 'กำลังวิเคราะห์…' : 'เริ่มวิเคราะห์'}
          </button>
        </div>
      )}

      {error ? <p className="border-t border-[#b95757]/25 bg-[#b95757]/10 px-5 py-3 text-[12px] text-[#efaaaa] sm:px-7">{error}</p> : null}
    </section>
  )
}
