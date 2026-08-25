'use client'

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  Heart,
  Images,
  Search,
  Share2,
  Sparkles,
  X,
} from 'lucide-react'

type PreviewPhoto = {
  id: string
  src: string
  alt: string
}

const heightClass = {
  short: 'h-[230px] sm:h-[250px]',
  medium: 'h-[310px] sm:h-[350px]',
  tall: 'h-[390px] sm:h-[450px]',
}

// Preserves the original staggered masonry rhythm now that tile heights
// are no longer hand-assigned to a fixed set of placeholder photos.
const heightPattern = [
  'tall',
  'medium',
  'short',
  'medium',
  'tall',
  'short',
  'medium',
  'tall',
  'medium',
] as const

export default function SharePreviewClient({
  photos,
  albumTitle,
  albumDescription,
  photoCount,
}: {
  photos: PreviewPhoto[]
  albumTitle: string
  albumDescription: string
  photoCount: number
}) {
  const [liked, setLiked] = useState<Set<string>>(
    () => new Set(photos.slice(1, 3).map((photo) => photo.id))
  )
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null)
  const [faceSearchOpen, setFaceSearchOpen] = useState(false)
  const [compactGrid, setCompactGrid] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const activePhoto = useMemo(
    () => photos.find((photo) => photo.id === selectedPhoto) ?? null,
    [photos, selectedPhoto]
  )

  function toggleLike(id: string) {
    setLiked((current) => {
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

  function moveLightbox(direction: -1 | 1) {
    if (selectedPhoto === null) return
    const currentIndex = photos.findIndex((photo) => photo.id === selectedPhoto)
    const nextIndex = (currentIndex + direction + photos.length) % photos.length
    setSelectedPhoto(photos[nextIndex].id)
  }

  if (photos.length === 0) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f1eb] px-6 text-center text-[#1b1b18]">
        <div>
          <p className="text-2xl font-black tracking-[-0.04em]">
            ยังไม่มีรูปให้พรีวิว
          </p>
          <p className="mt-2 text-sm font-medium text-black/50">
            หน้านี้ดึงรูปจากอัลบั้มสาธารณะล่าสุด — เผยแพร่อัลบั้มสักหนึ่งอัลบั้มแล้วเปิดใหม่อีกครั้ง
          </p>
        </div>
      </main>
    )
  }

  const remainingCount = Math.max(0, photoCount - photos.length)

  return (
    <main className="min-h-screen bg-[#F8F6F1] text-[#171717] selection:bg-[#C7A86B]/30">
      <header className="sticky top-0 z-40 border-b border-black/8 bg-[#f4f1eb]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-7 lg:px-10">
          <a href="#top" className="flex items-center gap-2.5" aria-label="Ciiya gallery home">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#1b1b18] text-sm font-black text-white">
              C
            </span>
            <span className="text-lg font-black tracking-[-0.05em]">ciiya</span>
          </a>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => showNotice('คัดลอกลิงก์อัลบั้มแล้ว')}
              className="grid h-10 w-10 place-items-center rounded-full border border-black/10 bg-white/70 transition hover:bg-white"
              aria-label="Share album"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => showNotice('เริ่มดาวน์โหลดรูปที่เลือก')}
              className="flex h-10 items-center gap-2 rounded-full bg-[#1b1b18] px-4 text-sm font-bold text-white transition hover:bg-black"
            >
              <ArrowDownToLine className="h-4 w-4" />
              <span className="hidden sm:inline">ดาวน์โหลด</span>
            </button>
          </div>
        </div>
      </header>

      <div id="top" className="mx-auto max-w-[1440px] px-4 pb-28 pt-4 sm:px-7 sm:pt-7 lg:px-10">
        <section className="relative min-h-[610px] overflow-hidden rounded-[30px] bg-[#1b1b18] sm:min-h-[660px] sm:rounded-[40px]">
          <img
            src={photos[0].src}
            alt={photos[0].alt}
            className="absolute inset-0 h-full w-full object-cover opacity-90"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-black/10" />

          <div className="relative flex min-h-[610px] flex-col justify-between p-5 text-white sm:min-h-[660px] sm:p-9 lg:p-12">
            <div className="flex items-start justify-between gap-4">
              <span className="rounded-full border border-white/30 bg-black/15 px-4 py-2 text-xs font-medium backdrop-blur-md">แกลเลอรีออนไลน์</span>
              <span className="rounded-full bg-[#C7A86B] px-4 py-2 text-xs font-medium text-[#171717]">อัปเดตล่าสุด 2 นาทีที่แล้ว</span>
            </div>

            <div className="max-w-4xl">
              <p className="mb-4 text-sm font-medium tracking-[0.12em] text-white/70">อัลบั้มที่แชร์</p>
              <h1 className="max-w-3xl text-[clamp(3.4rem,9vw,8.5rem)] font-black leading-[0.78] tracking-[-0.085em]">{albumTitle}</h1>
              <div className="mt-7 border-t border-white/25 pt-5">
                <p className="max-w-lg text-base font-medium leading-7 text-white/76 sm:text-lg">
                  {albumDescription || 'ดูและดาวน์โหลดรูปจากงานของคุณ'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="my-5 grid gap-3 sm:grid-cols-[1fr_auto]">
          <button
            type="button"
            onClick={() => setFaceSearchOpen(true)}
            className="group flex min-h-28 items-center justify-between rounded-[20px] border border-[#E8E4DC] bg-white px-5 text-left transition hover:border-[#C7A86B] sm:px-7"
          >
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[#1b1b18] text-white">
                <Sparkles className="h-6 w-6" />
              </span>
              <div>
                <p className="text-lg font-black tracking-[-0.035em] sm:text-xl">ค้นหารูปของคุณ</p>
                <p className="mt-1 text-sm font-semibold text-black/55">อัปโหลดเซลฟี่ แล้วให้ AI ช่วยค้นหา</p>
              </div>
            </div>
            <Search className="mr-2 h-6 w-6 transition group-hover:scale-110" />
          </button>

          <div className="flex items-center justify-between gap-5 rounded-[20px] border border-[#E8E4DC] bg-white px-6 py-5 sm:min-w-80">
            <div>
              <p className="text-xs font-medium text-black/50">รูปที่เลือกไว้</p>
              <p className="mt-1 text-xl font-black">{liked.size} รูปที่ชอบ</p>
            </div>
            <Heart className="h-7 w-7 fill-[#C7A86B] text-[#C7A86B]" />
          </div>
        </section>

        <section className="pt-12">
          <div className="mb-7 flex items-end justify-between gap-5">
            <div>
              <p className="text-xs font-medium text-black/45">รูปภาพในอัลบั้ม</p>
              <h2 className="mt-2 text-4xl font-black tracking-[-0.065em] sm:text-6xl">ทุกช่วงเวลา</h2>
            </div>
            <button
              type="button"
              onClick={() => setCompactGrid((value) => !value)}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-black/10 bg-white/65 transition hover:bg-white"
              aria-label="เปลี่ยนรูปแบบแกลเลอรี"
            >
              {compactGrid ? <Images className="h-5 w-5" /> : <Grid2X2 className="h-5 w-5" />}
            </button>
          </div>

          <div className={compactGrid ? 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4' : 'columns-1 gap-3 sm:columns-2 lg:columns-3'}>
            {photos.map((photo, index) => {
              const isLiked = liked.has(photo.id)
              return (
                <article
                  key={photo.id}
                  className={`group relative mb-3 break-inside-avoid overflow-hidden rounded-[22px] bg-[#ddd8cf] ${compactGrid ? 'aspect-[4/5]' : heightClass[heightPattern[index % heightPattern.length]]}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedPhoto(photo.id)}
                    className="absolute inset-0 z-10"
                    aria-label={`เปิดรูป ${photo.alt}`}
                  />
                  <img
                    src={photo.src}
                    alt={photo.alt}
                    loading={index > 2 ? 'lazy' : 'eager'}
                    className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.025]"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
                  <div className="absolute bottom-3 left-3 z-20 rounded-full bg-black/45 px-3 py-1.5 text-xs font-bold text-white opacity-0 backdrop-blur-md transition group-hover:opacity-100">
                    #{String(index + 1).padStart(3, '0')}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleLike(photo.id)}
                    className={`absolute right-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-full backdrop-blur-md transition ${isLiked ? 'bg-[#C7A86B] text-[#171717]' : 'bg-black/25 text-white hover:bg-white hover:text-black'}`}
                    aria-label={isLiked ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                  </button>
                </article>
              )
            })}
          </div>

          <div className="mt-14 flex flex-col items-center rounded-[30px] border border-black/8 bg-white/55 px-6 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#1b1b18] text-white">
              <Camera className="h-5 w-5" />
            </span>
            <p className="mt-5 text-2xl font-black tracking-[-0.045em]">
              {remainingCount > 0
                ? `ยังมีอีก ${remainingCount} ช่วงเวลา`
                : 'ครบทุกช่วงเวลาแล้ว'}
            </p>
            <p className="mt-2 max-w-md text-sm font-medium leading-6 text-black/50">
              รูปใหม่จะปรากฏที่นี่อัตโนมัติเมื่อช่างภาพอัปโหลดเสร็จ
            </p>
            <button type="button" onClick={() => showNotice('กำลังโหลดรูปเพิ่มเติม')} className="mt-6 rounded-full bg-[#1b1b18] px-6 py-3 text-sm font-bold text-white">
              ดูรูปเพิ่มเติม
            </button>
          </div>
        </section>

        <footer className="mt-20 flex flex-col gap-4 border-t border-black/10 py-8 text-sm font-semibold text-black/45 sm:flex-row sm:items-center sm:justify-between">
          <p>แกลเลอรีโดย Ciiya · เพื่อทุกช่วงเวลาของคุณ</p>
          <p>{albumTitle}</p>
        </footer>
      </div>

      {activePhoto ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#171714]/98 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="Photo preview">
          <button type="button" onClick={() => setSelectedPhoto(null)} className="absolute right-4 top-4 z-20 grid h-11 w-11 place-items-center rounded-full bg-white/12 text-white backdrop-blur-md" aria-label="ปิดรูปภาพ">
            <X className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => moveLightbox(-1)} className="absolute left-3 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/12 text-white sm:left-6" aria-label="รูปก่อนหน้า">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <img src={activePhoto.src} alt={activePhoto.alt} className="max-h-[86vh] max-w-full rounded-[20px] object-contain" />
          <button type="button" onClick={() => moveLightbox(1)} className="absolute right-3 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/12 text-white sm:right-6" aria-label="รูปถัดไป">
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 rounded-full bg-white px-3 py-2 shadow-2xl">
            <button type="button" onClick={() => toggleLike(activePhoto.id)} className="grid h-10 w-10 place-items-center rounded-full bg-[#F8F6F1]" aria-label="เลือกรูปโปรด">
              <Heart className={`h-4 w-4 ${liked.has(activePhoto.id) ? 'fill-[#C7A86B] text-[#C7A86B]' : ''}`} />
            </button>
            <button type="button" onClick={() => showNotice('เตรียมดาวน์โหลดรูปนี้')} className="flex h-10 items-center gap-2 rounded-full bg-[#1b1b18] px-4 text-sm font-bold text-white">
              <ArrowDownToLine className="h-4 w-4" /> ดาวน์โหลด
            </button>
          </div>
        </div>
      ) : null}

      {faceSearchOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="ค้นหารูปด้วยใบหน้า">
          <div className="w-full max-w-lg rounded-t-[34px] bg-[#f7f4ee] p-6 shadow-2xl sm:rounded-[34px] sm:p-8">
            <div className="flex items-start justify-between">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[#C7A86B]">
                <Sparkles className="h-5 w-5" />
              </span>
              <button type="button" onClick={() => setFaceSearchOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-black/5" aria-label="ปิดการค้นหาใบหน้า">
                <X className="h-5 w-5" />
              </button>
            </div>
            <h2 className="mt-7 text-4xl font-black tracking-[-0.065em]">ค้นหาคุณในอัลบั้ม</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-black/55">
              เลือกรูปเซลฟี่ที่เห็นใบหน้าชัด ระบบจะค้นหารูปที่มีคุณอยู่ โดยตัวอย่างนี้ยังไม่อัปโหลดข้อมูลจริง
            </p>
            <label className="mt-7 flex cursor-pointer flex-col items-center rounded-[24px] border-2 border-dashed border-black/15 bg-white/60 px-5 py-9 text-center transition hover:border-black/35">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[#1b1b18] text-white">
                <Camera className="h-6 w-6" />
              </span>
              <span className="mt-4 text-base font-black">เลือกหรือถ่ายเซลฟี่</span>
              <span className="mt-1 text-xs font-semibold text-black/40">JPG, PNG หรือ WEBP</span>
              <input type="file" accept="image/*" className="hidden" onChange={() => showNotice('ตัวอย่างนี้ยังไม่ส่งรูปไปยังระบบ')} />
            </label>
            <div className="mt-5 flex items-center gap-2 text-xs font-semibold text-black/45">
              <Check className="h-4 w-4" /> รูปจะใช้เพื่อค้นหาและไม่ถูกเก็บในแกลเลอรี
            </div>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-[#1b1b18] px-5 py-3 text-sm font-bold text-white shadow-2xl">
          {notice}
        </div>
      ) : null}
    </main>
  )
}
