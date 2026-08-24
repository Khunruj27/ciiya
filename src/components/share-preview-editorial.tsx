'use client'

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Heart,
  Menu,
  ScanFace,
  Share2,
  X,
} from 'lucide-react'

type StoryPhoto = {
  id: string
  src: string
  alt: string
  chapter: string
}

// Chapter captions are a fixed part of the editorial layout rather than
// per-photo data, so they cycle across however many photos the album has.
const chapterLabels = [
  'Before the ceremony',
  'The promise',
  'The details',
  'Just us',
  'Dinner begins',
  'Golden hour',
  'Our people',
  'Little things',
  'After dark',
]

export default function SharePreviewEditorial({
  photos,
  albumTitle,
  albumDescription,
  photoCount,
}: {
  photos: { id: string; src: string; alt: string }[]
  albumTitle: string
  albumDescription: string
  photoCount: number
}) {
  const storyPhotos: StoryPhoto[] = useMemo(
    () =>
      photos.map((photo, index) => ({
        ...photo,
        chapter: chapterLabels[index % chapterLabels.length],
      })),
    [photos]
  )

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [faceSearchOpen, setFaceSearchOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const activePhoto = useMemo(
    () => storyPhotos.find((photo) => photo.id === activeId) ?? null,
    [storyPhotos, activeId]
  )

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 2200)
  }

  function moveActive(direction: -1 | 1) {
    if (activeId === null) return
    const currentIndex = storyPhotos.findIndex((photo) => photo.id === activeId)
    const nextIndex = (currentIndex + direction + storyPhotos.length) % storyPhotos.length
    setActiveId(storyPhotos[nextIndex].id)
  }

  if (storyPhotos.length === 0) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#eee9df] px-6 text-center text-[#181814]">
        <div>
          <p className="text-2xl font-black tracking-[-0.05em]">
            ยังไม่มีรูปให้พรีวิว
          </p>
          <p className="mt-2 text-sm font-medium text-black/50">
            หน้านี้ดึงรูปจากอัลบั้มสาธารณะล่าสุด — เผยแพร่อัลบั้มสักหนึ่งอัลบั้มแล้วเปิดใหม่อีกครั้ง
          </p>
        </div>
      </main>
    )
  }

  const remainingCount = Math.max(0, photoCount - storyPhotos.length)
  const coverPhoto = storyPhotos[1] ?? storyPhotos[0]

  return (
    <main className="min-h-screen bg-[#eee9df] text-[#181814] selection:bg-[#181814] selection:text-white">
      <nav className="relative z-40 border-b border-black/15">
        <div className="mx-auto grid h-[74px] max-w-[1600px] grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-8 lg:px-12">
          <button type="button" className="flex items-center gap-2 justify-self-start text-xs font-bold uppercase tracking-[0.17em]" aria-label="Open menu">
            <Menu className="h-4 w-4" />
            <span className="hidden sm:inline">Album menu</span>
          </button>
          <a href="#begin" className="text-xl font-black tracking-[-0.06em]">ciiya.</a>
          <button type="button" onClick={() => showNotice('คัดลอกลิงก์อัลบั้มแล้ว')} className="flex items-center gap-2 justify-self-end text-xs font-bold uppercase tracking-[0.17em]">
            <span className="hidden sm:inline">Share</span>
            <Share2 className="h-4 w-4" />
          </button>
        </div>
      </nav>

      <section id="begin" className="mx-auto grid min-h-[calc(100vh-74px)] max-w-[1600px] border-x border-black/15 lg:grid-cols-[0.8fr_1.35fr]">
        <div className="flex flex-col justify-between border-b border-black/15 p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-12">
          <div className="flex items-start justify-between text-[11px] font-bold uppercase tracking-[0.18em] text-black/50">
            <span>Shared album</span>
            <span>{photoCount} photographs</span>
          </div>

          <div className="py-20 lg:py-10">
            <p className="font-serif text-2xl italic text-black/55">The album</p>
            <h1 className="mt-5 text-[clamp(4rem,9vw,8.8rem)] font-black leading-[0.76] tracking-[-0.09em]">
              {albumTitle}
            </h1>
            <p className="mt-10 max-w-md text-sm font-semibold leading-7 text-black/55">
              {albumDescription || 'ดูและดาวน์โหลดรูปจากงานของคุณ'}
            </p>
          </div>

          <a href="#story" className="flex items-center justify-between border-t border-black/15 pt-5 text-xs font-black uppercase tracking-[0.16em]">
            Begin the story
            <ArrowDown className="h-4 w-4" />
          </a>
        </div>

        <div className="relative min-h-[62vh] overflow-hidden bg-[#c9c0b0] lg:min-h-0">
          <img src={coverPhoto.src} alt={coverPhoto.alt} className="absolute inset-0 h-full w-full object-cover grayscale-[8%]" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/65 to-transparent p-6 pt-36 text-white sm:p-10">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Cover photograph</p>
              <p className="mt-2 font-serif text-xl italic">{coverPhoto.chapter}</p>
            </div>
            <p className="text-xs font-bold">{photoCount} ภาพ</p>
          </div>
        </div>
      </section>

      <section id="story" className="mx-auto max-w-[1600px] border-x border-black/15">
        <div className="grid border-b border-black/15 lg:grid-cols-[0.62fr_1.38fr]">
          <div className="border-b border-black/15 p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-12">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-black/45">Chapter one</p>
            <h2 className="mt-6 text-5xl font-black leading-[0.86] tracking-[-0.075em] sm:text-7xl">
              Before<br />it all<br />began.
            </h2>
            <p className="mt-8 max-w-xs font-serif text-lg italic leading-7 text-black/55">
              Quiet rooms, careful hands, and the feeling that something wonderful was about to happen.
            </p>
          </div>

          <div className="grid gap-px bg-black/15 sm:grid-cols-2">
            {storyPhotos.slice(0, 2).map((photo, index) => (
              <StoryTile key={photo.id} photo={photo} index={index} selected={selected.has(photo.id)} onOpen={setActiveId} onToggle={toggleSelected} tall />
            ))}
          </div>
        </div>

        <div className="grid gap-px border-b border-black/15 bg-black/15 sm:grid-cols-3">
          {storyPhotos.slice(2, 5).map((photo, index) => (
            <StoryTile key={photo.id} photo={photo} index={index + 2} selected={selected.has(photo.id)} onOpen={setActiveId} onToggle={toggleSelected} />
          ))}
        </div>

        <div className="grid border-b border-black/15 bg-[#181814] text-white lg:grid-cols-[1.2fr_0.8fr]">
          <div className="flex min-h-[430px] flex-col justify-between p-6 sm:p-10 lg:p-14">
            <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">
              <ScanFace className="h-4 w-4" /> Smart photo search
            </div>
            <div>
              <h2 className="max-w-3xl text-5xl font-black leading-[0.88] tracking-[-0.075em] sm:text-7xl lg:text-8xl">
                Find yourself<br />in the story.
              </h2>
              <p className="mt-7 max-w-lg text-sm font-medium leading-7 text-white/50">
                อัปโหลดเซลฟี่หนึ่งรูป ระบบจะช่วยค้นหาทุกช่วงเวลาที่มีคุณอยู่ในอัลบั้มนี้
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setFaceSearchOpen(true)} className="group flex min-h-[260px] flex-col items-center justify-center border-t border-white/15 bg-[#e2ff6f] p-8 text-[#181814] transition hover:bg-white lg:min-h-0 lg:border-l lg:border-t-0">
            <span className="grid h-24 w-24 place-items-center rounded-full border border-black/25 transition group-hover:scale-105">
              <ScanFace className="h-10 w-10" />
            </span>
            <span className="mt-8 text-sm font-black uppercase tracking-[0.16em]">ค้นหารูปของฉัน</span>
          </button>
        </div>

        <div className="grid border-b border-black/15 lg:grid-cols-[0.42fr_1.58fr]">
          <aside className="border-b border-black/15 p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-12">
            <div className="lg:sticky lg:top-8">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-black/45">Chapter two</p>
              <h2 className="mt-5 text-5xl font-black leading-[0.88] tracking-[-0.07em]">After<br />the vows.</h2>
              <div className="mt-10 flex items-center gap-3 border-t border-black/15 pt-5 text-xs font-bold">
                <Heart className="h-4 w-4" />
                {selected.size} รูปที่เลือกไว้
              </div>
            </div>
          </aside>

          <div className="grid gap-px bg-black/15 sm:grid-cols-2">
            {storyPhotos.slice(5).map((photo, index) => (
              <StoryTile key={photo.id} photo={photo} index={index + 5} selected={selected.has(photo.id)} onOpen={setActiveId} onToggle={toggleSelected} tall={index === 0 || index === 3} />
            ))}
          </div>
        </div>

        <div className="p-6 sm:p-10 lg:p-14">
          <div className="flex flex-col items-start justify-between gap-10 border-b border-black/15 pb-10 sm:flex-row sm:items-end">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-black/45">The full collection</p>
              <p className="mt-5 max-w-3xl font-serif text-3xl italic leading-tight sm:text-5xl">
                {remainingCount > 0
                  ? `${remainingCount} more photographs are waiting for you.`
                  : 'You have reached the end of the collection.'}
              </p>
            </div>
            <button type="button" onClick={() => showNotice('กำลังโหลดภาพชุดถัดไป')} className="flex shrink-0 items-center gap-5 rounded-full bg-[#181814] py-2 pl-6 pr-2 text-xs font-black uppercase tracking-[0.14em] text-white">
              Load more
              <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-black"><ArrowDown className="h-4 w-4" /></span>
            </button>
          </div>

          <footer className="flex flex-col gap-6 pt-10 text-xs font-bold uppercase tracking-[0.14em] text-black/45 sm:flex-row sm:items-center sm:justify-between">
            <p>Private gallery · {albumTitle}</p>
            <p>Made with Ciiya</p>
            <p>{photoCount} photographs</p>
          </footer>
        </div>
      </section>

      {selected.size > 0 ? (
        <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl items-center justify-between rounded-full bg-[#181814] py-2 pl-5 pr-2 text-white shadow-2xl sm:bottom-5">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e2ff6f] text-xs font-black text-black">{selected.size}</span>
            <span className="text-sm font-bold">รูปที่เลือก</span>
          </div>
          <button type="button" onClick={() => showNotice(`เตรียมดาวน์โหลด ${selected.size} รูป`)} className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-black">
            <ArrowDownToLine className="h-4 w-4" /> Download
          </button>
        </div>
      ) : null}

      {activePhoto ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#11110e]/98 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Photo preview">
          <div className="absolute inset-x-5 top-5 z-20 flex items-center justify-between text-white sm:inset-x-8 sm:top-7">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/60">{activePhoto.chapter}</p>
            <button type="button" onClick={() => setActiveId(null)} className="grid h-11 w-11 place-items-center rounded-full border border-white/20" aria-label="Close photo"><X className="h-5 w-5" /></button>
          </div>
          <img src={activePhoto.src} alt={activePhoto.alt} className="max-h-[80vh] max-w-full object-contain" />
          <div className="absolute inset-x-5 bottom-5 z-20 flex items-center justify-between sm:inset-x-8 sm:bottom-7">
            <button type="button" onClick={() => moveActive(-1)} className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white"><ArrowLeft className="h-4 w-4" /> Prev</button>
            <button type="button" onClick={() => toggleSelected(activePhoto.id)} className={`grid h-12 w-12 place-items-center rounded-full ${selected.has(activePhoto.id) ? 'bg-[#e2ff6f] text-black' : 'border border-white/25 text-white'}`} aria-label="Select photo"><Heart className={`h-5 w-5 ${selected.has(activePhoto.id) ? 'fill-current' : ''}`} /></button>
            <button type="button" onClick={() => moveActive(1)} className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white">Next <ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      ) : null}

      {faceSearchOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Face search preview">
          <div className="w-full max-w-2xl bg-[#eee9df] p-6 sm:p-10">
            <div className="flex items-center justify-between border-b border-black/15 pb-5">
              <p className="text-[11px] font-black uppercase tracking-[0.2em]">Smart photo search</p>
              <button type="button" onClick={() => setFaceSearchOpen(false)} aria-label="Close face search"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-8 py-8 sm:grid-cols-[0.8fr_1.2fr] sm:items-center">
              <div className="grid aspect-square place-items-center rounded-full border border-dashed border-black/25 bg-[#e2ff6f]">
                <ScanFace className="h-16 w-16" />
              </div>
              <div>
                <h2 className="text-4xl font-black leading-[0.9] tracking-[-0.065em] sm:text-5xl">Find every photo you are in.</h2>
                <p className="mt-5 text-sm font-medium leading-6 text-black/55">เลือกเซลฟี่ที่เห็นใบหน้าชัด ตัวอย่างนี้จะแสดงเฉพาะขั้นตอนและยังไม่ส่งไฟล์ไปยังระบบจริง</p>
                <label className="mt-7 flex cursor-pointer items-center justify-between border-y border-black/15 py-4 text-xs font-black uppercase tracking-[0.14em]">
                  Choose a selfie
                  <Camera className="h-5 w-5" />
                  <input type="file" accept="image/*" className="hidden" onChange={() => showNotice('ตัวอย่างนี้ยังไม่ส่งรูปไปยังระบบ')} />
                </label>
                <div className="mt-4 flex gap-2 text-[11px] font-semibold text-black/45"><Check className="h-4 w-4 shrink-0" /> รูปเซลฟี่จะไม่ถูกเพิ่มเข้าอัลบั้ม</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="fixed left-1/2 top-5 z-[100] -translate-x-1/2 rounded-full bg-[#181814] px-5 py-3 text-sm font-bold text-white shadow-2xl">{notice}</div>
      ) : null}
    </main>
  )
}

function StoryTile({
  photo,
  index,
  selected,
  onOpen,
  onToggle,
  tall = false,
}: {
  photo: StoryPhoto
  index: number
  selected: boolean
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  tall?: boolean
}) {
  return (
    <article className={`group relative overflow-hidden bg-[#cfc6b7] ${tall ? 'h-[540px] sm:h-[650px]' : 'h-[430px] sm:h-[520px]'}`}>
      <button type="button" onClick={() => onOpen(photo.id)} className="absolute inset-0 z-10" aria-label={`Open ${photo.alt}`} />
      <img src={photo.src} alt={photo.alt} loading={index > 2 ? 'lazy' : 'eager'} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.02]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60" />
      <div className="absolute inset-x-5 bottom-5 z-20 flex items-end justify-between gap-4 text-white">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">No. {String(index + 1).padStart(3, '0')}</p>
          <p className="mt-1 font-serif text-lg italic">{photo.chapter}</p>
        </div>
        <button type="button" onClick={() => onToggle(photo.id)} className={`grid h-11 w-11 place-items-center rounded-full backdrop-blur-md transition ${selected ? 'bg-[#e2ff6f] text-black' : 'border border-white/35 bg-black/10 text-white hover:bg-white hover:text-black'}`} aria-label={selected ? 'Remove selection' : 'Select photo'}>
          <Heart className={`h-4 w-4 ${selected ? 'fill-current' : ''}`} />
        </button>
      </div>
    </article>
  )
}
