'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

type Category = {
  id: string
  name: string
}

type Props = {
  albumId: string
  categories?: Category[]
}

type UploadStatus =
  | 'waiting'
  | 'uploading'
  | 'queued'
  | 'done'
  | 'error'

type UploadItem = {
  id: string
  file: File
  progress: number
  status: UploadStatus
  error?: string
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

function makeItemId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`
}

function getSafeFileName(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg'
  const baseName = fileName.replace(/\.[^/.]+$/, '')

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

  return `${Date.now()}-${crypto.randomUUID()}-${safeBaseName || 'photo'}.${ext}`
}

export default function UploadPhotoForm({
  albumId,
  categories = [],
}: Props) {
  const router = useRouter()

  const [items, setItems] = useState<UploadItem[]>([])
  const [presetFile, setPresetFile] = useState<File | null>(null)
  const [size, setSize] = useState('original')
  const [categoryId, setCategoryId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [currentFileName, setCurrentFileName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const totalSelectedBytes = useMemo(() => {
    return items.reduce((sum, item) => sum + item.file.size, 0)
  }, [items])

  const uploadedCount = useMemo(() => {
    return items.filter(
      (item) => item.status === 'queued' || item.status === 'done'
    ).length
  }, [items])

  const failedCount = useMemo(() => {
    return items.filter((item) => item.status === 'error').length
  }, [items])

  const totalProgress = useMemo(() => {
    if (!items.length) return 0

    const total = items.reduce((sum, item) => {
      if (item.status === 'queued' || item.status === 'done') return sum + 100
      return sum + item.progress
    }, 0)

    return Math.round(total / items.length)
  }, [items])

  function updateItem(id: string, update: Partial<UploadItem>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...update } : item))
    )
  }

  function removeItem(id: string) {
    if (uploading) return
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  function clearCompleted() {
    if (uploading) return

    setItems((prev) =>
      prev.filter((item) => item.status !== 'queued' && item.status !== 'done')
    )
  }

  async function uploadDirectToSupabase(item: UploadItem) {
    const supabase = createClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      throw new Error('Unauthorized')
    }

    updateItem(item.id, {
      progress: 10,
      status: 'uploading',
    })

    const safeFileName = getSafeFileName(item.file.name)
    const storagePath = `${user.id}/${albumId}/original/${safeFileName}`

    const { error: uploadError } = await supabase.storage
      .from('albums')
      .upload(storagePath, item.file, {
        contentType: item.file.type || 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      throw new Error(uploadError.message)
    }

    updateItem(item.id, {
      progress: 80,
      status: 'uploading',
    })

    const finalizeRes = await fetch('/api/photos/finalize-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        albumId,
        storagePath,
        fileName: item.file.name,
        fileSizeBytes: item.file.size,
        size,
        categoryId: categoryId || null,
      }),
    })

    const finalizeData = await finalizeRes.json().catch(() => null)

    if (!finalizeRes.ok || !finalizeData?.success) {
      await supabase.storage.from('albums').remove([storagePath])

      throw new Error(
        finalizeData?.error || finalizeData?.jobError || 'Finalize upload failed'
      )
    }

    updateItem(item.id, {
      progress: 100,
      status: 'queued',
      error: undefined,
    })

    return finalizeData
  }

  async function handleUpload() {
    setErrorMsg('')
    setSuccessMsg('')

    if (items.length === 0) {
      setErrorMsg('Please select at least one JPG file')
      return
    }

    const invalidFile = items.find((item) => {
      const file = item.file

      return !(
        file.type === 'image/jpeg' ||
        file.name.toLowerCase().endsWith('.jpg') ||
        file.name.toLowerCase().endsWith('.jpeg')
      )
    })

    if (invalidFile) {
      setErrorMsg('Only JPG/JPEG files are allowed')
      return
    }

    if (presetFile && !presetFile.name.toLowerCase().endsWith('.xmp')) {
      setErrorMsg('Only .xmp preset file is allowed')
      return
    }

    try {
      setUploading(true)

      const uploadItems = items.filter(
        (item) => item.status === 'waiting' || item.status === 'error'
      )

      for (const item of uploadItems) {
        setCurrentFileName(item.file.name)

        updateItem(item.id, {
          progress: 0,
          status: 'uploading',
          error: undefined,
        })

        try {
          const data = await uploadDirectToSupabase(item)

          if (
            data?.error?.includes('Storage full') ||
            data?.jobError?.includes('Storage full')
          ) {
            window.location.href = '/pricing'
            return
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Upload failed'

          updateItem(item.id, {
            status: 'error',
            error: message,
          })

          setErrorMsg(message)

          if (message.includes('Storage full')) {
            window.location.href = '/pricing'
            return
          }
        }
      }

      setCurrentFileName('')
      setSuccessMsg(
        presetFile
          ? `Upload queued with preset: ${uploadItems.length} file(s)`
          : `Upload queued: ${uploadItems.length} file(s)`
      )

      router.refresh()
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Upload failed')
      setCurrentFileName('')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4 rounded-3xl bg-white p-4 shadow-sm">
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-500">Photos</label>

        <input
          type="file"
          multiple
          accept=".jpg,.jpeg,image/jpeg"
          onChange={(e) => {
            const selected = Array.from(e.target.files || [])

            const newItems: UploadItem[] = selected.map((file) => ({
              id: makeItemId(file),
              file,
              progress: 0,
              status: 'waiting',
            }))

            setItems((prev) => [...prev, ...newItems])
            setCurrentFileName('')
            setErrorMsg('')
            setSuccessMsg('')

            e.currentTarget.value = ''
          }}
          className="block w-full text-sm text-slate-600"
          disabled={uploading}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-500">
          Lightroom Preset (.xmp)
        </label>

        <input
          type="file"
          accept=".xmp"
          onChange={(e) => {
            const file = e.target.files?.[0] || null
            setPresetFile(file)
            setErrorMsg('')
            setSuccessMsg('')
          }}
          className="block w-full text-sm text-slate-600"
          disabled={uploading}
        />

        {presetFile ? (
          <div className="rounded-2xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-600">
            Preset selected: {presetFile.name}
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Optional: choose a Lightroom .xmp preset before upload
          </p>
        )}
      </div>

      <select
        value={size}
        onChange={(e) => setSize(e.target.value)}
        className="w-full rounded-xl border border-slate-200 p-3 text-sm"
        disabled={uploading}
      >
        <option value="sd">SD (2000px)</option>
        <option value="hd">HD (3000px)</option>
        <option value="uhd">UHD (4000px)</option>
        <option value="original">Original (original size)</option>
      </select>

      {categories.length > 0 ? (
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-xl border border-slate-200 p-3 text-sm"
          disabled={uploading}
        >
          <option value="">No Category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      ) : null}

      {items.length > 0 ? (
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="flex items-center justify-between text-sm text-slate-700">
            <span>Queue {items.length} file(s)</span>
            <span>{totalProgress}%</span>
          </div>

          <div className="mt-1 text-xs text-slate-400">
            Total size: {formatBytes(totalSelectedBytes)}
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${totalProgress}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              Uploaded {uploadedCount}/{items.length}
            </span>
            <span>{failedCount > 0 ? `Failed ${failedCount}` : 'Ready'}</span>
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-slate-100 p-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-700">
                    {item.file.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {formatBytes(item.file.size)}
                  </p>
                </div>

                {!uploading ? (
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500"
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    item.status === 'error' ? 'bg-red-500' : 'bg-blue-600'
                  }`}
                  style={{ width: `${item.progress}%` }}
                />
              </div>

              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span
                  className={
                    item.status === 'error'
                      ? 'text-red-500'
                      : item.status === 'queued' || item.status === 'done'
                      ? 'text-green-600'
                      : 'text-slate-500'
                  }
                >
                  {item.status === 'waiting' && 'Waiting'}
                  {item.status === 'uploading' && `Uploading ${item.progress}%`}
                  {item.status === 'queued' && 'Uploaded • Processing preview'}
                  {item.status === 'done' && 'Done'}
                  {item.status === 'error' && (item.error || 'Error')}
                </span>

                <span className="text-slate-400">{item.progress}%</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {currentFileName ? (
        <p className="truncate text-xs text-slate-400">
          Current: {currentFileName}
        </p>
      ) : null}

      {errorMsg ? <p className="text-sm text-red-500">{errorMsg}</p> : null}

      {successMsg ? (
        <p className="text-sm text-green-600">{successMsg}</p>
      ) : null}

      <div className="space-y-2">
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || items.length === 0}
          className="w-full rounded-xl bg-blue-600 py-3 text-white disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : 'Start Upload'}
        </button>

        {items.some(
          (item) => item.status === 'queued' || item.status === 'done'
        ) ? (
          <button
            type="button"
            onClick={clearCompleted}
            disabled={uploading}
            className="w-full rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-600 disabled:opacity-50"
          >
            Clear completed
          </button>
        ) : null}
      </div>
    </div>
  )
}