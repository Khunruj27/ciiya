'use client'

import { useCallback, useMemo, useState } from 'react'
import Cropper from 'react-easy-crop'
import { useRouter } from 'next/navigation'
import AppIcon from '@/components/app-icon'

type Props = {
  albumId: string
  iconOnly?: boolean
}

type Area = {
  width: number
  height: number
  x: number
  y: number
}

export default function CoverCropUpload({
  albumId,
  iconOnly = false,
}: Props) {
  const router = useRouter()

  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [fileName, setFileName] = useState('cover.jpg')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const aspect = useMemo(() => 1125 / 600, [])

  function onSelectFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const isImage =
      file.type.startsWith('image/') ||
      file.name.toLowerCase().endsWith('.jpg') ||
      file.name.toLowerCase().endsWith('.jpeg') ||
      file.name.toLowerCase().endsWith('.png')

    if (!isImage) {
      alert('Please choose an image file')
      return
    }

    setFileName(file.name.replace(/\.[^/.]+$/, '') + '.jpg')

    const reader = new FileReader()
    reader.addEventListener('load', () => {
      setImageSrc(String(reader.result))
      setOpen(true)
    })
    reader.readAsDataURL(file)

    e.target.value = ''
  }

  const onCropComplete = useCallback(
    (_croppedArea: unknown, croppedPixels: Area) => {
      setCroppedAreaPixels(croppedPixels)
    },
    []
  )

  async function createImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = src
    })
  }

  async function getCroppedBlob(src: string, cropArea: Area): Promise<Blob> {
    const image = await createImage(src)

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('Canvas context not available')
    }

    canvas.width = 1125
    canvas.height = 600

    ctx.drawImage(
      image,
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height,
      0,
      0,
      1125,
      600
    )

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create cropped image'))
            return
          }

          resolve(blob)
        },
        'image/jpeg',
        0.9
      )
    })
  }

  async function handleUploadCover() {
    if (!imageSrc || !croppedAreaPixels) return

    try {
      setLoading(true)

      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels)
      const file = new File([blob], fileName, { type: 'image/jpeg' })

      const formData = new FormData()
      formData.append('file', file)
      formData.append('albumId', albumId)
      formData.append('size', 'original')
      formData.append('isCover', 'true')

      const res = await fetch('/api/photos/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Upload failed')
      }

      setOpen(false)
      setImageSrc(null)
      setZoom(1)
      setCrop({ x: 0, y: 0 })

      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

function closeModal() {
  if (loading) return

  setOpen(false)
  setImageSrc(null)
  setZoom(1)
  setCrop({ x: 0, y: 0 })
  setCroppedAreaPixels(null)
}

  return (
    <>
      {iconOnly ? (
        <label
          title="Upload Cover Image"
          className="flex"
        >
          <AppIcon name="panorama" size={24} className="opacity-80" />

          <input
            type="file"
            accept="image/*,.jpg,.jpeg,.png"
            onChange={onSelectFile}
            className="hidden"
          />
        </label>
      ) : (
        <div className="rounded-[30px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="rounded-[26px] bg-gradient-to-br from-slate-950 to-slate-700 p-5 text-white">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
              Album Cover
            </p>

            <h3 className="mt-3 text-[26px] font-black leading-none tracking-[-0.05em]">
              Upload cover
            </h3>

            <p className="mt-3 text-sm leading-6 text-white/60">
              Crop image to 1125 × 600 before saving as album cover.
            </p>
          </div>

          <label className="mt-4 flex h-14 cursor-pointer items-center justify-center rounded-full bg-[#2F6BFF] text-sm font-black text-white shadow-[0_16px_35px_rgba(47,107,255,0.28)] transition active:scale-[0.98]">
            เลือกรูปหน้าปก

            <input
              type="file"
              accept="image/*,.jpg,.jpeg,.png"
              onChange={onSelectFile}
              className="hidden"
            />
          </label>
        </div>
      )}

      {open && imageSrc ? (
        <div
  className="
  fixed inset-0 z-[9999]
  flex items-end justify-center
  bg-black/45 backdrop-blur-md
  px-5
  pt-[max(60px,env(safe-area-inset-top))]
  pb-[max(40px,env(safe-area-inset-bottom))]
  sm:items-center
"
>
          <button
            type="button"
            aria-label="ปิดหน้าต่างครอบตัดรูป"
            onClick={() => {
            if (!loading) closeModal()
            }}
            className="absolute inset-0 cursor-default"
          />

          <div
  className="
  relative z-10
  flex flex-col
  w-full
  max-w-[390px]
  max-h-[calc(100dvh-110px)]
  overflow-hidden
  rounded-[30px]
  bg-white
  shadow-[0_30px_80px_rgba(15,23,42,0.22)]
"
>
            <div className="flex shrink-0 items-start justify-between px-5 pb-3 pt-4">
              <div>
                <h2 className="mt-2 text-[28px] font-black leading-none tracking-[-0.05em]">
                  จัดตำแหน่งรูปหน้าปก
                </h2>

                <p className="mt-2 text-sm font-medium text-slate-500">
                  สัดส่วนภาพ 1125:600
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                 if (!loading) closeModal()
                 }}
                disabled={loading}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F6F7FA] text-[22px] font-black text-black transition active:scale-95">
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(24px,env(safe-area-inset-bottom))]">
              <div className="relative h-[320px] sm:h-[420px] w-full overflow-hidden rounded-[24px] bg-slate-950 ring-1 ring-black/10">
                <Cropper
                  image={imageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={aspect}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              </div>

              <div className="mt-5 rounded-[20px] bg-[#F8F9FC] p-4 ring-1 ring-black/5">
                <div className="mb-3 flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-700">
                    ขยายภาพ
                  </label>

                  <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500 shadow-sm">
                    {zoom.toFixed(1)}x
                  </span>
                </div>

                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.1}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full accent-[#F0B1DE]"
                />
              </div>

              <button
                type="button"
                onClick={handleUploadCover}
                disabled={loading}
                className="mt-5 flex h-[52px] w-full items-center justify-center rounded-[18px] bg-[#F0B1DE] text-[15px] font-black text-white border border-black/5 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? 'กำลังบันทึก…' : 'บันทึกรูปหน้าปก'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
