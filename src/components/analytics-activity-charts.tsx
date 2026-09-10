'use client'

import { useId, useState } from 'react'
import { useI18n } from '@/components/i18n-provider'

type Day = { key: string; label: string; count: number; views: number; likes: number; other: number }

function weekdayLabel(key: string, locale: string) {
  const date = new Date(`${key}T12:00:00+07:00`)
  if (locale === 'th') return ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'][date.getUTCDay()]
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'Asia/Bangkok' }).format(date)
}

export function DailyActivityChart({ days }: { days: Day[] }) {
  const { locale, t } = useI18n()
  const [metric, setMetric] = useState<'count' | 'views' | 'likes' | 'other'>('count')
  const [selected, setSelected] = useState<number | null>(null)
  const gradient = useId()
  const choices = [
    { key: 'count' as const, label: locale === 'th' ? 'ทั้งหมด' : 'All activity' },
    { key: 'views' as const, label: t.analytics.statViews },
    { key: 'likes' as const, label: t.analytics.statHearts },
    { key: 'other' as const, label: locale === 'th' ? 'กิจกรรมอื่น ๆ' : 'Other activity' },
  ]
  const ceiling = Math.max(4, Math.ceil(Math.max(0, ...days.map(day => day[metric])) / 4) * 4)
  const points = days.map((day, index) => ({ x: index / Math.max(1, days.length - 1) * 100, y: 100 - day[metric] / ceiling * 100 }))
  const path = points.map((point, index) => {
    if (!index) return `M ${point.x} ${point.y}`
    const before = points[index - 1]
    const middle = (before.x + point.x) / 2
    return `C ${middle} ${before.y}, ${middle} ${point.y}, ${point.x} ${point.y}`
  }).join(' ')
  const active = selected === null ? null : days[selected]
  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-2" aria-label={t.analytics.activity7Day}>
        {choices.map(choice => <button key={choice.key} type="button" aria-pressed={metric === choice.key} onClick={() => setMetric(choice.key)} className={`min-h-11 rounded-full px-3 text-[12px] transition ${metric === choice.key ? 'bg-gold-soft text-gold-deep' : 'text-muted hover:bg-ground'}`}>{choice.label}</button>)}
      </div>
      <p role="status" className="mt-2 min-h-6 text-[12px] text-muted">{active ? `${active.key} · ${active[metric].toLocaleString(locale)} ${locale === 'th' ? 'กิจกรรม' : 'events'}` : locale === 'th' ? 'แตะจุดบนกราฟเพื่อดูจำนวนกิจกรรม' : 'Select a point to see activity counts'}</p>
      <div className="mt-4 flex gap-3">
        <div aria-hidden className="flex h-40 w-8 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-muted sm:h-48">{[4,3,2,1,0].map(step => <span key={step}>{ceiling * step / 4}</span>)}</div>
        <div className="min-w-0 flex-1 px-2">
          <div className="relative h-40 sm:h-48">
            <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
              <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C7A86B" stopOpacity=".25" /><stop offset="100%" stopColor="#C7A86B" stopOpacity=".02" /></linearGradient></defs>
              {[0,25,50,75,100].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#E8E4DC" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
              <path d={`${path} L 100 100 L 0 100 Z`} fill={`url(#${gradient})`} />
              <path d={path} fill="none" stroke="#B39152" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            </svg>
            {points.map((point,index) => <button key={days[index].key} type="button" onFocus={() => setSelected(index)} onClick={() => setSelected(index)} onMouseEnter={() => setSelected(index)} aria-label={`${days[index].key}, ${choices.find(choice => choice.key === metric)?.label}: ${days[index][metric]}`} aria-pressed={selected === index} style={{left: `${point.x}%`, top: `${point.y}%`}} className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-gold"><span className={`h-2.5 w-2.5 rounded-full border-2 border-white bg-[#B39152] ${selected === index ? 'ring-4 ring-gold/20' : ''}`} /></button>)}
          </div>
          <div className="relative mt-5 h-5 text-[10px] text-muted">{days.map((day,index) => <span key={day.key} title={day.key} style={{left: `${points[index].x}%`}} className={`absolute whitespace-nowrap ${index === 0 ? '' : index === days.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}>{weekdayLabel(day.key, locale)}</span>)}</div>
        </div>
      </div>
      {!days.some(day => day[metric] > 0) ? <p className="mt-4 text-[12px] text-muted">{locale === 'th' ? 'ยังไม่มีกิจกรรมประเภทนี้ในช่วง 7 วัน' : 'No activity of this type in the last 7 days.'}</p> : null}
    </div>
  )
}

export function HourlyActivityChart({ counts, peak }: { counts: number[]; peak: number }) {
  const { t, locale } = useI18n()
  const [selected, setSelected] = useState<number | null>(null)
  const max = Math.max(1, ...counts)
  const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
  return <div className="mt-5">
    <p role="status" className="min-h-6 text-[12px] text-muted">{selected === null ? (locale === 'th' ? 'กิจกรรมรายชั่วโมง · 30 วันล่าสุด · เวลาไทย' : 'Hourly activity · Last 30 days · Bangkok time') : t.analytics.hourTitle(hourLabel(selected), counts[selected])}</p>
    <div className="mt-4 flex h-32 items-end gap-[2px] sm:h-40 sm:gap-[3px]">
      {counts.map((count,index) => <button key={index} type="button" onFocus={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onClick={() => setSelected(index)} aria-label={t.analytics.hourTitle(hourLabel(index),count)} aria-pressed={selected === index} className="flex h-full min-w-0 flex-1 items-end rounded-t-md focus-visible:outline-2 focus-visible:outline-gold"><span style={{height: `${count / max * 100}%`}} className={`w-full rounded-t-[4px] ${index === peak ? 'bg-[#B39152]' : 'bg-[#E8E4DC]'}`} /></button>)}
    </div>
    <div className="mt-2 flex justify-between text-[10px] tabular-nums text-muted">{[0,6,12,18,23].map(hour => <span key={hour}>{hourLabel(hour)}</span>)}</div>
  </div>
}
