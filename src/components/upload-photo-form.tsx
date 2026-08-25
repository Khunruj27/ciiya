'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useRouter } from 'next/navigation'
import type { OptimisticUpload } from '@/components/optimistic-upload'


type Category = {
  id: string
  name: string
}

type Props = {
  albumId: string
  categories?: Category[]
  initialAutoFaceScan?: boolean
  initialAutoPublish?: boolean
  onUploadStarted?: () => void
  onOptimisticUploads?: (items: OptimisticUpload[]) => void
}

type UploadStatus =
  | 'waiting'
  | 'uploading'
  | 'queued'
  | 'done'
  | 'duplicate'
  | 'error'

type UploadItem = {
  id: string
  file: File
  progress: number
  status: UploadStatus
  error?: string
}

const UPLOAD_CONCURRENCY = 2
const MAX_UPLOAD_RETRIES = 3

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

function getQuickFileHash(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

async function retryAsync<T>(
  fn: () => Promise<T>,
  retries = MAX_UPLOAD_RETRIES,
  delay = 1000
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delay * attempt))
      }
    }
  }

  throw lastError
}

export default function UploadPhotoForm({
  albumId,
  categories = [],
  initialAutoFaceScan = true,
  initialAutoPublish = false,
  onUploadStarted,
  onOptimisticUploads,
}: Props) {
  const supabase = useMemo(() => createClient(), [])

  const mountedRef = useRef(true)
  const uploadingRef = useRef(false)
  const uploadLockRef = useRef(false)

  const [items, setItems] = useState<UploadItem[]>([])
  const [presetFile, setPresetFile] = useState<File | null>(null)
  const [size, setSize] = useState('original')
  const [autoFaceScan] = useState(initialAutoFaceScan)
  const [autoPublish] = useState(initialAutoPublish)
  const [categoryId, setCategoryId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [currentFileName, setCurrentFileName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const router = useRouter()

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    uploadingRef.current = uploading
  }, [uploading])

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!uploadingRef.current) return

      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  function safeSetUploading(value: boolean) {
    if (!mountedRef.current) return
    setUploading(value)
  }

  function safeSetCurrentFileName(value: string) {
    if (!mountedRef.current) return
    setCurrentFileName(value)
  }

  function safeSetErrorMsg(value: string) {
    if (!mountedRef.current) return
    setErrorMsg(value)
  }

  function safeSetSuccessMsg(value: string) {
    if (!mountedRef.current) return
    setSuccessMsg(value)
  }

  function isMounted() {
  return mountedRef.current
}

  const totalSelectedBytes = useMemo(() => {
    return items.reduce((sum, item) => sum + item.file.size, 0)
  }, [items])

  const uploadedCount = useMemo(() => {
    return items.filter(
      (item) =>
        item.status === 'queued' ||
        item.status === 'done' ||
        item.status === 'duplicate'
    ).length
  }, [items])

  const failedCount = useMemo(() => {
    return items.filter((item) => item.status === 'error').length
  }, [items])

  const totalProgress = useMemo(() => {
    if (!items.length) return 0

    const total = items.reduce((sum, item) => {
      if (
        item.status === 'queued' ||
        item.status === 'done' ||
        item.status === 'duplicate'
      ) {
        return sum + 100
      }

      return sum + item.progress
    }, 0)

    return Math.round(total / items.length)
  }, [items])

  function updateItem(id: string, update: Partial<UploadItem>) {
    if (!mountedRef.current) return

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
      prev.filter(
        (item) =>
          item.status !== 'queued' &&
          item.status !== 'done' &&
          item.status !== 'duplicate'
      )
    )
  }

  async function uploadDirectToSupabase(
    item: UploadItem,
    context: {
      userId: string
      presetPath: string | null
    }
  ) {
    const userId = context.userId
    const presetPath = context.presetPath

    updateItem(item.id, {
      progress: 10,
      status: 'uploading',
    })

    const safeFileName = getSafeFileName(item.file.name)
    const fileHash = getQuickFileHash(item.file)
    const storagePath = `${userId}/${albumId}/original/${safeFileName}`

    const { error: uploadError } = await retryAsync(() =>
      supabase.storage.from('albums').upload(storagePath, item.file, {
        contentType: item.file.type || 'image/jpeg',
        upsert: false,
      })
    )

    if (uploadError) {
      throw new Error(uploadError.message)
    }

    updateItem(item.id, {
      progress: 80,
      status: 'uploading',
    })

    const finalizeRes = await retryAsync(() =>
      fetch('/api/photos/finalize-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          albumId,
          storagePath,
          fileName: item.file.name,
          fileHash,
          fileSizeBytes: item.file.size,
          size,
          categoryId: categoryId || null,
          presetPath,
          autoFaceScan,
          autoPublish,
        }),
      })
    )

    const finalizeData = await finalizeRes.json().catch(() => null)

    if (finalizeData?.duplicate) {
      await supabase.storage.from('albums').remove([storagePath])

      updateItem(item.id, {
        progress: 100,
        status: 'duplicate',
        error: undefined,
      })

      return finalizeData
    }

    if (!finalizeRes.ok || !finalizeData?.success) {
  await supabase.storage.from('albums').remove([storagePath])

  if (finalizeData?.code === 'STORAGE_LIMIT_EXCEEDED') {
    throw new Error('STORAGE_LIMIT_EXCEEDED')
  }

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

  async function runUploadPool(
    uploadItems: UploadItem[],
    context: {
      userId: string
      presetPath: string | null
    }
  ) {
    let currentIndex = 0
    let shouldStop = false

    const results: {
      success: boolean
      status?: UploadStatus
      error?: string
    }[] = []

    async function worker() {
      while (currentIndex < uploadItems.length && !shouldStop) {
        const item = uploadItems[currentIndex]
        currentIndex += 1

        if (!item) continue

        safeSetCurrentFileName(item.file.name)

        updateItem(item.id, {
          progress: 0,
          status: 'uploading',
          error: undefined,
        })

        try {
          const data = await uploadDirectToSupabase(item, context)

          if (
  data?.code === 'STORAGE_LIMIT_EXCEEDED' ||
  data?.error?.includes('Storage full') ||
  data?.jobError?.includes('Storage full')
) {
  throw new Error('STORAGE_LIMIT_EXCEEDED')
}

          results.push({
            success: true,
            status: data?.duplicate ? 'duplicate' : 'queued',
          })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Upload failed'

          updateItem(item.id, {
            status: 'error',
            error: message,
          })

          results.push({
            success: false,
            error: message,
          })

          if (
  message.includes('STORAGE_LIMIT_EXCEEDED') ||
  message.includes('Storage full')
) {
            shouldStop = true

            uploadItems.slice(currentIndex).forEach((pendingItem) => {
              updateItem(pendingItem.id, {
                status: 'error',
               error: 'Storage limit reached',
              })
            })
             
            safeSetErrorMsg('Storage limit reached. Please upgrade your plan.')

if (isMounted()) {
  router.push('/pricing')
}

return
          }
        }
      }
    }

    const workerCount = Math.max(
  1,
  Math.min(UPLOAD_CONCURRENCY, uploadItems.length)
)

await Promise.allSettled(
  Array.from({ length: workerCount }, () => worker())
)

    return results
  }

  async function handleUpload() {
    safeSetErrorMsg('')
    safeSetSuccessMsg('')

    if (uploadLockRef.current) {
  return
}

uploadLockRef.current = true

    if (items.length === 0) {
      safeSetErrorMsg('Please select at least one JPG file')
      return
    }

    const uploadItems = items.filter(
      (item) => item.status === 'waiting' || item.status === 'error'
    )

    if (uploadItems.length === 0) {
      safeSetErrorMsg('No pending files to upload')
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
      safeSetErrorMsg('Only JPG/JPEG files are allowed')
      return
    }

    if (presetFile && !presetFile.name.toLowerCase().endsWith('.xmp')) {
      safeSetErrorMsg('Only .xmp preset file is allowed')
      return
    }

    try {
safeSetUploading(true)

if (isMounted()) {
  onUploadStarted?.()

  onOptimisticUploads?.(
    uploadItems.map((item) => ({
      id: item.id,
      fileName: item.file.name,
      fileHash: `${item.file.name}-${item.file.size}-${item.file.lastModified}`,
      progress: 5,
      status: 'uploading',
    }))
  )
}

  const {
    data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unauthorized')
      }

      let sharedPresetPath: string | null = null

      if (presetFile) {
        const presetSafeName = getSafeFileName(presetFile.name)
        sharedPresetPath = `${user.id}/${albumId}/presets/${presetSafeName}`

        const { error: presetUploadError } = await retryAsync(() =>
          supabase.storage.from('albums').upload(sharedPresetPath!, presetFile, {
            contentType: 'application/xml',
            upsert: true,
          })
        )

        if (presetUploadError) {
          throw new Error(presetUploadError.message)
        }
      }

      const results = await runUploadPool(uploadItems, {
        userId: user.id,
        presetPath: sharedPresetPath,
      })

      safeSetCurrentFileName('')

      const successCount = results.filter((item) => item.success).length
      const errorCount = results.filter((item) => !item.success).length

      safeSetSuccessMsg(
        presetFile
          ? `เพิ่มเข้าคิวพร้อมพรีเซ็ตแล้ว ${successCount}/${uploadItems.length} ไฟล์`
          : `เพิ่มเข้าคิวแล้ว ${successCount}/${uploadItems.length} ไฟล์`
      )

      if (successCount === uploadItems.length) {
        setPresetFile(null)
      }

      if (errorCount > 0) {
        safeSetErrorMsg(
          `อัปโหลดไม่สำเร็จ ${errorCount} ไฟล์ กดเริ่มอัปโหลดอีกครั้งเพื่อลองใหม่`
        )
      }
    } catch (error) {
      safeSetErrorMsg(error instanceof Error ? error.message : 'อัปโหลดไม่สำเร็จ')
      safeSetCurrentFileName('')
    } finally {
  uploadLockRef.current = false
  safeSetUploading(false)
}
  }

  return (
    <div className="space-y-4 rounded-panel bg-surface p-1">
      {/* JPG Photos */}
<div className="space-y-2">
  <label className="text-xs font-semibold text-muted">
    รูปภาพ JPG
  </label>

  <input
    type="file"
    multiple
    accept=".jpg,.jpeg,image/jpeg"
    onChange={(e) => {
     const selected = Array.from(e.target.files || []).filter(

  (file) => file.size > 0

)

setItems((prev) => {
  const pending = prev.filter(
    (item) =>
      item.status === 'waiting' ||
      item.status === 'uploading' ||
      item.status === 'error'
  )

  const existingHashes = new Set(
    pending.map((item) => getQuickFileHash(item.file))
  )

  const newItems: UploadItem[] = []

  for (const file of selected) {
    const hash = getQuickFileHash(file)

    if (existingHashes.has(hash)) {
      continue
    }

    existingHashes.add(hash)

    newItems.push({
      id: makeItemId(file),
      file,
      progress: 0,
      status: 'waiting',
    })
  }

  return [...pending, ...newItems]
})

      setCurrentFileName('')
      setErrorMsg('')
      setSuccessMsg('')

      e.currentTarget.value = ''
    }}
    className="block w-full rounded-control border border-line bg-ground p-3 text-sm text-muted"
    disabled={uploading}
  />

  <p className="text-xs text-muted">
    เลือกรูป JPG/JPEG ได้ครั้งละหลายรูป
  </p>
</div>
    

     <div className="space-y-2">
        <label className="text-xs font-semibold text-muted">
          พรีเซ็ต Lightroom (.xmp)
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
          className="block w-full rounded-2xl border border-line bg-ground-sunken p-3 text-sm text-ink-soft"
          disabled={uploading}
        />

        {presetFile ? (
          <div className="rounded-2xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-600">
            เลือกพรีเซ็ตแล้ว: {presetFile.name}
          </div>
        ) : (
          <p className="text-xs text-muted">
            ไม่บังคับ: เลือกพรีเซ็ต .xmp ก่อนอัปโหลด
          </p>
        )}
      </div>

      <select
        value={size}
        onChange={(e) => setSize(e.target.value)}
        className="w-full rounded-xl border border-line p-3 text-sm"
        disabled={uploading}
      >
        <option value="sd">SD (2000px)</option>
        <option value="hd">HD (3000px)</option>
        <option value="uhd">UHD (4000px)</option>
        <option value="original">ต้นฉบับ (ขนาดเดิม)</option>
      </select>

      {categories.length > 0 ? (
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-xl border border-line p-3 text-sm"
          disabled={uploading}
        >
          <option value="">ไม่ระบุหมวดหมู่</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      ) : null}

      {items.length > 0 ? (
        <div className="rounded-2xl bg-ground-sunken p-3">
          <div className="flex items-center justify-between text-sm text-ink-soft">
            <span>คิวอัปโหลด {items.length} ไฟล์</span>
            <span>{totalProgress}%</span>
          </div>

          <div className="mt-1 text-xs text-muted">
            ขนาดรวม: {formatBytes(totalSelectedBytes)}
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ground-sunken">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${totalProgress}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>
              อัปโหลดแล้ว {uploadedCount}/{items.length}
            </span>
            <span>{failedCount > 0 ? `ไม่สำเร็จ ${failedCount}` : 'พร้อมอัปโหลด'}</span>
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-line p-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-line"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-ink-soft">
                    {item.file.name}
                  </p>

                  <p className="mt-0.5 text-[11px] text-muted">
                    {formatBytes(item.file.size)}
                  </p>
                </div>

                {!uploading ? (
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="shrink-0 rounded-full bg-ground-sunken px-2 py-1 text-[11px] text-muted"
                  >
                    นำออก
                  </button>
                ) : null}
              </div>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ground-sunken">
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
                      : item.status === 'queued' ||
                          item.status === 'done' ||
                          item.status === 'duplicate'
                        ? 'text-green-600'
                        : 'text-muted'
                  }
                >
                  {item.status === 'waiting' && 'รออัปโหลด'}
                  {item.status === 'uploading' && `กำลังอัปโหลด ${item.progress}%`}
                  {item.status === 'queued' && 'อัปโหลดแล้ว • กำลังสร้างตัวอย่าง'}
                  {item.status === 'done' && 'เสร็จแล้ว'}
                  {item.status === 'duplicate' && 'ไฟล์ซ้ำ • อัปโหลดไว้แล้ว'}
                  {item.status === 'error' && (item.error || 'เกิดข้อผิดพลาด')}
                </span>

                <span className="text-muted">{item.progress}%</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {currentFileName ? (
        <p className="truncate text-xs text-muted">
          กำลังอัปโหลด: {currentFileName}
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
  disabled={uploading}
  className="w-full rounded-control bg-ink py-3 font-medium text-white disabled:opacity-50"
>
  {uploading ? 'กำลังอัปโหลด…' : 'เริ่มอัปโหลด'}
</button>

        {items.some(
          (item) =>
            item.status === 'queued' ||
            item.status === 'done' ||
            item.status === 'duplicate'
        ) ? (
          <button
            type="button"
            onClick={clearCompleted}
            disabled={uploading}
            className="w-full rounded-xl bg-ground-sunken py-3 text-sm font-semibold text-ink-soft disabled:opacity-50"
          >
            ล้างรายการที่เสร็จแล้ว
          </button>
        ) : null}
      </div>
    </div>
  )
}
