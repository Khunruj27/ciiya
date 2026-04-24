'use client'

import { useCallback, useMemo, useState } from 'react'
import Cropper from 'react-easy-crop'
import { useRouter } from 'next/navigation'

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

  return (
    <>
      {iconOnly ? (
        <label
          title="Upload Cover Image"
          className="cursor-pointer rounded-full bg-blue-100 p-2 text-sm text-blue-600 hover:bg-blue-200"
        >
          📷
          <input
            type="file"
            accept="image/*,.jpg,.jpeg,.png"
            onChange={onSelectFile}
            className="hidden"
          />
        </label>
      ) : (
        <div className="rounded-3xl bg-white p-4 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-900">
            Upload Cover Image
          </label>

          <p className="mb-3 text-xs text-slate-500">
            Crop image to 1125 × 600 before saving as album cover
          </p>

          <input
            type="file"
            accept="image/*,.jpg,.jpeg,.png"
            onChange={onSelectFile}
            className="block w-full text-sm text-slate-600"
          />
        </div>
      )}

      {open && imageSrc ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Crop Cover Image
                </h2>
                <p className="text-sm text-slate-500">Aspect ratio 1125:600</p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="relative h-[50vh] w-full overflow-hidden rounded-2xl bg-slate-900">
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

            <div className="mt-4">
              <label className="mb-2 block text-sm text-slate-600">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <button
              type="button"
              onClick={handleUploadCover}
              disabled={loading}
              className="mt-4 w-full rounded-2xl bg-blue-600 px-4 py-3 text-white disabled:opacity-50"
            >
              {loading ? 'Saving Cover...' : 'Save Cover'}
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}