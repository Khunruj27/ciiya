'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'

type Props = {
  albumId: string
}

export default function CameraProcessingQueue({
  albumId,
}: Props) {
  const [uploading, setUploading] = useState(0)
  const [processing, setProcessing] = useState(0)
  const [faceAi, setFaceAi] = useState(0)

  useEffect(() => {
    const supabase = createClient()

    async function loadStats() {
      const [
        cameraResult,
        photoResult,
        faceResult,
      ] = await Promise.all([
        supabase
          .from('camera_live_imports')
          .select('id', { count: 'exact', head: true })
          .eq('album_id', albumId)
          .in('status', ['uploading', 'imported', 'finalizing']),

        supabase
          .from('photo_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('album_id', albumId)
          .in('status', ['pending', 'processing']),

        supabase
          .from('face_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('album_id', albumId)
          .in('status', ['pending', 'processing']),
      ])

      setUploading(cameraResult.count || 0)
      setProcessing(photoResult.count || 0)
      setFaceAi(faceResult.count || 0)
    }

    loadStats()

    const channel = supabase
      .channel(`camera-queue-${albumId}`)

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'camera_live_imports',
          filter: `album_id=eq.${albumId}`,
        },
        loadStats
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photo_jobs',
          filter: `album_id=eq.${albumId}`,
        },
        loadStats
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'face_jobs',
          filter: `album_id=eq.${albumId}`,
        },
        loadStats
      )

      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [albumId])

  const total =
    uploading +
    processing +
    faceAi

  if (total === 0) return null

  return (
    <div className="mt-3 rounded-2xl bg-[#F7FAF1] px-4 py-3">
      <div className="flex items-center justify-between text-[12px] font-bold">
        <span>Uploading</span>
        <span>{uploading}</span>
      </div>

      <div className="mt-2 flex items-center justify-between text-[12px] font-bold">
        <span>Processing</span>
        <span>{processing}</span>
      </div>

      <div className="mt-2 flex items-center justify-between text-[12px] font-bold">
        <span>Face AI</span>
        <span>{faceAi}</span>
      </div>
    </div>
  )
}