'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useRouter } from 'next/navigation'

type ImportRow = {
  id: string
  album_id: string
  filename: string | null
  status: string | null
  progress: number | null
  storage_path?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type Props = {
  albumId: string
}

export default function CameraImportRealtimePreview({ albumId }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<ImportRow[]>([])

  useEffect(() => {
    const supabase = createClient()

    async function loadRecentImports() {
      const { data } = await supabase
        .from('camera_live_imports')
        .select('id, album_id, filename, status, progress, storage_path, created_at, updated_at')
        .eq('album_id', albumId)
        .in('status', ['pending', 'imported', 'uploading', 'finalizing'])
        .order('created_at', { ascending: false })
        .limit(12)

      setItems((data || []) as ImportRow[])
    }

    loadRecentImports()

    const channel = supabase
      .channel(`camera-imports:${albumId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'camera_live_imports',
          filter: `album_id=eq.${albumId}`,
        },
        (payload) => {
          const row = (payload.new || payload.old) as ImportRow | null
          if (!row?.id) return

          setItems((prev) => {
            const next = prev.filter((item) => item.id !== row.id)

            if (row.status === 'done') {
              window.setTimeout(() => router.refresh(), 500)
              return next
            }

            if (
              row.status === 'pending' ||
              row.status === 'imported' ||
              row.status === 'uploading' ||
              row.status === 'finalizing'
            ) {
              return [row, ...next].slice(0, 12)
            }

            return next
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [albumId, router])

  if (items.length === 0) return null

  return (
    <div className="mt-3 rounded-panel border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink">
          Camera importing
        </p>
        <p className="text-[11px] font-bold uppercase text-muted">
          Live
        </p>
      </div>

      <div className="space-y-2">
        {items.map((item) => {
          const progress = Math.max(0, Math.min(100, Number(item.progress || 0)))

          return (
            <div
              key={item.id}
              className="rounded-2xl bg-ground px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-ink">
                    {item.filename || 'Camera photo'}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-muted">
                    {item.status || 'processing'} • {progress}%
                  </p>
                </div>

                <div className="h-9 w-9 shrink-0 rounded-xl bg-gold-soft flex items-center justify-center text-[12px] font-semibold text-ink">
                  JPG
                </div>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-gold-soft"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}