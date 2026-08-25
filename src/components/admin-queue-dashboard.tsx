'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

type WorkerHeartbeat = {
  worker_id: string
  worker_name?: string | null
  worker_type?: string | null
  status?: string | null
  last_seen?: string | null
  last_seen_at?: string | null
  metadata?: Record<string, unknown> | null
}

type WorkerLog = {
  id?: string
  worker_type?: string | null
  level?: string | null
  message?: string | null
  photo_id?: string | null
  album_id?: string | null
  created_at?: string | null
}

type FailedJob = {
  id: string
  photo_id?: string | null
  album_id?: string | null
  status?: string | null
  retry_count?: number | null
  error?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
}

type QueueStats = {
  success: boolean
  photoJobs: Record<string, number>
  faceJobs: Record<string, number>
  cameraJobs: Record<string, number>
  recentPhotoJobs?: FailedJob[]
  recentFaceJobs?: FailedJob[]
  cameraSessions?: CameraSessionMonitorItem[]
  workers?: WorkerHeartbeat[]
  recentErrors?: WorkerLog[]
  failedPhotoJobs?: FailedJob[]
  failedFaceJobs?: FailedJob[]
  checkedAt: string
  recentCameraImports?: RecentCameraImport[]
  recentTimeline?: WorkerLog[]
  performanceAnalytics?: PerformanceAnalytics
  uploadRecoveryWatch?: UploadRecoveryWatch
}

type CameraSessionMonitorItem = {
  id: string
  album_id: string | null
  owner_id: string | null
  status: string | null
  resize_mode: string | null
  created_at: string | null
  updated_at: string | null
  last_activity_at: string | null
  started_at: string | null
  stopped_at: string | null
  counts?: Record<string, number>
  latest_import_filename?: string | null
  latest_import_at?: string | null
  total_imports?: number
}

type CleanupResult = {
  success: boolean
  dryRun: boolean
  bucket: string
  prefix: string
  scanned: number
  used: number
  orphanCount: number
  deletedCount: number
  limit: number
  sample: string[]
}

type RecentCameraImport = {
  id: string
  album_id: string | null
  filename: string | null
  status: string | null
  progress: number | null
  error: string | null
  created_at: string | null
  updated_at: string | null
}

type PerformanceAnalytics = {
  windowMinutes: number
  photoAvgSeconds: number | null
  faceAvgSeconds: number | null
  cameraAvgSeconds: number | null
  totalDone: number
  throughputPerMinute: number
}

type UploadRecoveryWatch = {
  stuckMinutes: number
  stuckPhotos: {
    id: string
    album_id: string | null
    filename: string | null
    processing_status: string | null
    processing_progress: number | null
    created_at: string | null
    updated_at: string | null
  }[]
  stuckJobs: {
    id: string
    photo_id: string | null
    album_id: string | null
    status: string | null
    progress: number | null
    retry_count: number | null
    error: string | null
    created_at: string | null
    started_at: string | null
    updated_at: string | null
  }[]
  failedPhotos: {
    id: string
    album_id: string | null
    filename: string | null
    processing_status: string | null
    processing_progress: number | null
    created_at: string | null
    updated_at: string | null
  }[]
  
}

function isWorkerOnline(worker: WorkerHeartbeat) {
  const lastSeen = worker.last_seen_at || worker.last_seen

  if (!lastSeen) return false

  const ageMs = Date.now() - new Date(lastSeen).getTime()

  return ageMs < 5 * 60 * 1000
}

function formatDate(value?: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString()
}

function getWorkerHealth(workers: WorkerHeartbeat[] = []) {
  const now = Date.now()

  const getAgeSeconds = (value?: string | null) => {
    if (!value) return null

    const time = new Date(value).getTime()

    if (!Number.isFinite(time)) return null

    return Math.max(0, Math.round((now - time) / 1000))
  }

  const normalized = workers.map((worker) => {
    const lastSeen = worker.last_seen_at || worker.last_seen || null
    const ageSeconds = getAgeSeconds(lastSeen)

    const online =
      String(worker.status || '').toLowerCase() === 'online' &&
      ageSeconds !== null &&
      ageSeconds <= 180

    return {
      ...worker,
      lastSeen,
      ageSeconds,
      online,
    }
  })

  const onlineCount = normalized.filter((worker) => worker.online).length
  const totalCount = normalized.length

  return {
    workers: normalized,
    onlineCount,
    totalCount,
    allOnline: totalCount > 0 && onlineCount === totalCount,
  }
}

function QueueCard({
  title,
  data,
}: {
  title: string
  data: Record<string, number>
}) {
  const pending = data.pending || 0
  const processing = data.processing || 0
  const done = data.done || 0
  const failed = data.failed || 0
  const total = pending + processing + done + failed

  return (
    <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <p className="mt-1 text-xs text-muted">Total jobs: {total}</p>
        </div>

        <div
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            failed > 0
              ? 'bg-red-50 text-red-700'
              : processing > 0
                ? 'bg-blue-50 text-blue-700'
                : pending > 0
                  ? 'bg-yellow-50 text-yellow-700'
                  : 'bg-green-50 text-green-700'
          }`}
        >
          {failed > 0
            ? 'Needs attention'
            : processing > 0
              ? 'Processing'
              : pending > 0
                ? 'Pending'
                : 'Healthy'}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-panel bg-yellow-50 p-4">
          <p className="text-xs font-medium text-yellow-700">Pending</p>
          <p className="mt-1 text-2xl font-semibold text-yellow-800">
            {pending}
          </p>
        </div>

        <div className="rounded-panel bg-blue-50 p-4">
          <p className="text-xs font-medium text-blue-700">Processing</p>
          <p className="mt-1 text-2xl font-semibold text-blue-800">
            {processing}
          </p>
        </div>

        <div className="rounded-panel bg-green-50 p-4">
          <p className="text-xs font-medium text-green-700">Done</p>
          <p className="mt-1 text-2xl font-semibold text-green-800">{done}</p>
        </div>

        <div className="rounded-panel bg-red-50 p-4">
          <p className="text-xs font-medium text-red-700">Failed</p>
          <p className="mt-1 text-2xl font-semibold text-red-800">{failed}</p>
        </div>
      </div>
    </div>
  )
}


function WorkerHealthSummary({ stats }: { stats: QueueStats }) {
  const health = getWorkerHealth(stats.workers || [])

  const pendingTotal =
    (stats.photoJobs?.pending || 0) +
    (stats.faceJobs?.pending || 0) +
    (stats.cameraJobs?.pending || 0)

  const activeTotal =
    (stats.photoJobs?.processing || 0) +
    (stats.faceJobs?.processing || 0) +
    (stats.cameraJobs?.imported || 0) +
    (stats.cameraJobs?.uploading || 0) +
    (stats.cameraJobs?.finalizing || 0)

  const failedTotal =
    (stats.photoJobs?.failed || 0) +
    (stats.faceJobs?.failed || 0) +
    (stats.cameraJobs?.failed || 0)

  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            System Health
          </p>

          <h2 className="mt-1 text-[26px] font-semibold tracking-[-0.05em] text-ink">
            {health.allOnline && failedTotal === 0
              ? 'All systems operational'
              : 'Attention needed'}
          </h2>

          <p className="mt-2 text-[13px] font-semibold text-muted">
            Last check:{' '}
            {stats.checkedAt ? new Date(stats.checkedAt).toLocaleString() : '-'}
          </p>
        </div>

        <div
          className={[
            'rounded-full px-4 py-2 text-[12px] font-semibold uppercase',
            health.allOnline && failedTotal === 0
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-600',
          ].join(' ')}
        >
          {health.onlineCount}/{health.totalCount || 0} workers online
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {health.workers.length > 0 ? (
          health.workers.map((worker) => (
            <div
              key={worker.worker_id || worker.worker_name || worker.worker_type || 'worker'}
              className="rounded-panel bg-ground p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-[13px] font-semibold text-ink">
                  {worker.worker_type || worker.worker_name || worker.worker_id}
                </p>

                <span
                  className={[
                    'h-2.5 w-2.5 rounded-full',
                    worker.online ? 'bg-green-500' : 'bg-red-500',
                  ].join(' ')}
                />
              </div>

              <p className="mt-2 text-[11px] font-semibold text-muted">
                {worker.online ? 'Online' : 'Offline'} ·{' '}
                {worker.ageSeconds !== null
                  ? `${worker.ageSeconds}s ago`
                  : 'No heartbeat'}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-panel bg-ground p-4 md:col-span-3">
            <p className="text-[13px] font-bold text-muted">
              No worker heartbeat records
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Pending
          </p>
          <p className="mt-1 text-[24px] font-semibold text-ink">
            {pendingTotal}
          </p>
        </div>

        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Active
          </p>
          <p className="mt-1 text-[24px] font-semibold text-ink">
            {activeTotal}
          </p>
        </div>

        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Failed
          </p>
          <p className="mt-1 text-[24px] font-semibold text-ink">
            {failedTotal}
          </p>
        </div>
      </div>
    </div>
  )
}

function LiveAlertCard({ stats }: { stats: QueueStats }) {
  const alerts: {
    level: 'success' | 'warning' | 'danger'
    title: string
    detail: string
  }[] = []

  const workers = stats.workers || []
  const onlineWorkers = workers.filter(isWorkerOnline).length

  if (workers.length > 0 && onlineWorkers < workers.length) {
    alerts.push({
      level: 'danger',
      title: 'Worker Offline',
      detail: `${workers.length - onlineWorkers} worker(s) offline`,
    })
  }

  if ((stats.photoJobs?.failed || 0) > 0) {
    alerts.push({
      level: 'danger',
      title: 'Photo Queue Failed',
      detail: `${stats.photoJobs.failed} failed job(s)`,
    })
  }

  if ((stats.faceJobs?.failed || 0) > 0) {
    alerts.push({
      level: 'danger',
      title: 'Face Queue Failed',
      detail: `${stats.faceJobs.failed} failed job(s)`,
    })
  }

  if ((stats.cameraJobs?.failed || 0) > 0) {
    alerts.push({
      level: 'danger',
      title: 'Camera Queue Failed',
      detail: `${stats.cameraJobs.failed} failed job(s)`,
    })
  }

  if ((stats.cameraJobs?.pending || 0) >= 20) {
    alerts.push({
      level: 'warning',
      title: 'Camera Queue High',
      detail: `${stats.cameraJobs.pending} pending`,
    })
  }

  if (alerts.length === 0) {
    alerts.push({
      level: 'success',
      title: 'System Healthy',
      detail: 'No active alerts',
    })
  }

  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Monitoring
          </p>

          <h2 className="mt-1 text-[24px] font-semibold text-ink">
            Live Alerts
          </h2>
        </div>

        <span className="rounded-full bg-ground-sunken px-3 py-1 text-[11px] font-semibold text-muted">
          {alerts.length}
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {alerts.map((alert, index) => (
          <div
            key={index}
            className={[
              'flex items-start gap-3 rounded-panel p-4',
              alert.level === 'danger'
                ? 'bg-red-50'
                : alert.level === 'warning'
                ? 'bg-yellow-50'
                : 'bg-green-50',
            ].join(' ')}
          >
            <div
              className={[
                'mt-1 h-3 w-3 rounded-full',
                alert.level === 'danger'
                  ? 'bg-red-500'
                  : alert.level === 'warning'
                  ? 'bg-yellow-500'
                  : 'bg-green-500',
              ].join(' ')}
            />

            <div>
              <p className="text-[13px] font-semibold text-ink">
                {alert.title}
              </p>

              <p className="mt-1 text-[12px] font-semibold text-[#666]">
                {alert.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SystemOverviewCard({ stats }: { stats: QueueStats }) {
  const photoFailed = stats.photoJobs?.failed || 0
  const faceFailed = stats.faceJobs?.failed || 0
  const cameraFailed = stats.cameraJobs?.failed || 0

  const photoActive = stats.photoJobs?.processing || 0
  const faceActive = stats.faceJobs?.processing || 0
  const cameraActive =
    (stats.cameraJobs?.pending || 0) +
    (stats.cameraJobs?.imported || 0) +
    (stats.cameraJobs?.uploading || 0) +
    (stats.cameraJobs?.finalizing || 0)

  const workers = stats.workers || []
  const onlineWorkers = workers.filter(isWorkerOnline).length
  const allWorkersOnline =
    workers.length > 0 && onlineWorkers === workers.length

  const items = [
    {
      label: 'Database',
      healthy: true,
      value: 'Connected',
    },
    {
      label: 'Photo Worker',
      healthy: allWorkersOnline,
      value: `${onlineWorkers}/${workers.length || 0}`,
    },
    {
      label: 'Photo Queue',
      healthy: photoFailed === 0,
      value: photoActive > 0 ? `${photoActive} active` : 'Clear',
    },
    {
      label: 'Face Queue',
      healthy: faceFailed === 0,
      value: faceActive > 0 ? `${faceActive} active` : 'Clear',
    },
    {
      label: 'Camera Queue',
      healthy: cameraFailed === 0,
      value: cameraActive > 0 ? `${cameraActive} active` : 'Clear',
    },
    {
      label: 'Errors',
      healthy: (stats.recentErrors || []).length === 0,
      value: `${stats.recentErrors?.length || 0}`,
    },
  ]

  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Monitoring
          </p>

          <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.04em] text-ink">
            System Overview
          </h2>
        </div>

        <span className="rounded-full bg-green-50 px-3 py-1 text-[11px] font-semibold text-green-700">
          Live
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-panel bg-ground p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold text-ink">
                {item.label}
              </p>

              <span
                className={[
                  'h-2.5 w-2.5 rounded-full',
                  item.healthy ? 'bg-green-500' : 'bg-red-500',
                ].join(' ')}
              />
            </div>

            <p className="mt-2 text-[11px] font-semibold text-muted">
              {item.healthy ? 'Healthy' : 'Attention'} · {item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function LivePerformanceCard({ stats }: { stats: QueueStats }) {
  const photoActive = stats.photoJobs?.processing || 0
  const faceActive = stats.faceJobs?.processing || 0
  const cameraActive =
    (stats.cameraJobs?.pending || 0) +
    (stats.cameraJobs?.imported || 0) +
    (stats.cameraJobs?.uploading || 0) +
    (stats.cameraJobs?.finalizing || 0)

  const totalDone =
    (stats.photoJobs?.done || 0) +
    (stats.faceJobs?.done || 0) +
    (stats.cameraJobs?.done || 0)

  const totalFailed =
    (stats.photoJobs?.failed || 0) +
    (stats.faceJobs?.failed || 0) +
    (stats.cameraJobs?.failed || 0)

  const maxValue = Math.max(photoActive, faceActive, cameraActive, 1)

  const rows = [
    {
      label: 'Photo',
      value: photoActive,
      width: `${Math.round((photoActive / maxValue) * 100)}%`,
    },
    {
      label: 'Face',
      value: faceActive,
      width: `${Math.round((faceActive / maxValue) * 100)}%`,
    },
    {
      label: 'Camera',
      value: cameraActive,
      width: `${Math.round((cameraActive / maxValue) * 100)}%`,
    },
  ]

  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Performance
          </p>

          <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.04em] text-ink">
            Live Processing Load
          </h2>
        </div>

        <span className="rounded-full bg-ground-sunken px-3 py-1 text-[11px] font-semibold text-muted">
          Auto refresh
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-ink">
              <span>{row.label}</span>
              <span>{row.value} active</span>
            </div>

            <div className="h-3 overflow-hidden rounded-full bg-ground">
              <div
                className="h-full rounded-full bg-gold transition-all duration-300"
                style={{ width: row.width }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Total Done
          </p>
          <p className="mt-1 text-[24px] font-semibold text-ink">
            {totalDone}
          </p>
        </div>

        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Failed
          </p>
          <p className="mt-1 text-[24px] font-semibold text-ink">
            {totalFailed}
          </p>
        </div>
      </div>
    </div>
  )
}

function UploadRecoveryWatchCard({
  data,
}: {
  data?: UploadRecoveryWatch
}) {
  const stuckPhotos = data?.stuckPhotos || []
  const stuckJobs = data?.stuckJobs || []
  const failedPhotos = data?.failedPhotos || []
  const hasIssue =
    stuckPhotos.length > 0 || stuckJobs.length > 0 || failedPhotos.length > 0

  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Recovery
          </p>

          <h2 className="mt-1 text-[24px] font-semibold text-ink">
            Upload Recovery Watch
          </h2>
        </div>

        <span
          className={[
            'rounded-full px-3 py-1 text-[11px] font-semibold uppercase',
            hasIssue
              ? 'bg-yellow-50 text-yellow-700'
              : 'bg-green-50 text-green-700',
          ].join(' ')}
        >
          {hasIssue ? 'Check' : 'Clear'}
        </span>
      </div>

      <p className="mt-2 text-[12px] font-semibold text-muted">
        Detect pending / processing items older than {data?.stuckMinutes || 10}{' '}
        minutes. Read only.
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Stuck Photos
          </p>
          <p className="mt-1 text-[26px] font-semibold text-ink">
            {stuckPhotos.length}
          </p>
        </div>

        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Stuck Jobs
          </p>
          <p className="mt-1 text-[26px] font-semibold text-ink">
            {stuckJobs.length}
          </p>
        </div>

        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Failed Photos
          </p>
          <p className="mt-1 text-[26px] font-semibold text-ink">
            {failedPhotos.length}
          </p>
        </div>
      </div>

      {hasIssue ? (
        <div className="mt-5 space-y-2">
          {[...stuckPhotos, ...failedPhotos].slice(0, 8).map((item) => (
            <div
              key={item.id}
              className="rounded-card bg-ground p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {item.filename || item.id}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-muted">
                    Album: {item.album_id || '-'}
                  </p>
                </div>

                <span className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase text-ink">
                  {item.processing_status || 'unknown'}
                </span>
              </div>

              <p className="mt-2 text-[11px] font-semibold text-muted">
                Updated: {formatDate(item.updated_at)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RecentCameraImports({
  items = [],
}: {
  items?: RecentCameraImport[]
}) {
  return (
    <div className="rounded-panel border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Camera
          </p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.04em] text-ink">
            Recent Imports
          </h2>
        </div>

        <span className="rounded-full bg-ground-sunken px-3 py-1 text-[11px] font-semibold text-muted">
          {items.length} latest
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {items.length > 0 ? (
          items.map((item) => (
            <div
              key={item.id}
              className="rounded-card border border-line bg-ground p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {item.filename || 'Untitled file'}
                  </p>

                  <p className="mt-1 truncate text-[11px] font-semibold text-muted">
                    Album: {item.album_id || '-'}
                  </p>
                </div>

                <span className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase text-ink">
                  {item.status || 'unknown'}
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-gold"
                  style={{
                    width: `${Math.max(0, Math.min(100, Number(item.progress || 0)))}%`,
                  }}
                />
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-muted">
                <span>{Number(item.progress || 0)}%</span>
                <span>
                  {item.created_at
                    ? new Date(item.created_at).toLocaleString()
                    : '-'}
                </span>
              </div>

              {item.error ? (
                <p className="mt-2 rounded-card bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
                  {item.error}
                </p>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-panel bg-ground px-4 py-8 text-center">
            <p className="text-[13px] font-bold text-muted">
              No recent camera imports
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function PerformanceAnalyticsCard({
  data,
}: {
  data?: PerformanceAnalytics
}) {
  const formatSeconds = (value?: number | null) => {
    if (value === null || value === undefined) return '-'
    return `${value}s`
  }

  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Analytics
          </p>

          <h2 className="mt-1 text-[24px] font-semibold text-ink">
            Performance Analytics
          </h2>
        </div>

        <span className="rounded-full bg-ground-sunken px-3 py-1 text-[11px] font-semibold text-muted">
          Last {data?.windowMinutes || 60} min
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Camera
          </p>
          <p className="mt-1 text-[24px] font-semibold text-ink">
            {formatSeconds(data?.cameraAvgSeconds)}
          </p>
        </div>

        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Photo
          </p>
          <p className="mt-1 text-[24px] font-semibold text-ink">
            {formatSeconds(data?.photoAvgSeconds)}
          </p>
        </div>

        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Face
          </p>
          <p className="mt-1 text-[24px] font-semibold text-ink">
            {formatSeconds(data?.faceAvgSeconds)}
          </p>
        </div>

        <div className="rounded-panel bg-gold-soft p-4">
          <p className="text-[11px] font-semibold uppercase text-gold-deep">
            Throughput
          </p>
          <p className="mt-1 text-[24px] font-semibold text-ink">
            {data?.throughputPerMinute ?? 0}/min
          </p>
        </div>
      </div>

      <p className="mt-4 text-[12px] font-semibold text-muted">
        Completed jobs in window: {data?.totalDone || 0}
      </p>
    </div>
  )
}

function CameraSessionMonitor({
  sessions = [],
}: {
  sessions?: CameraSessionMonitorItem[]
}) {
  return (
    <div className="rounded-panel border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Camera
          </p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.04em] text-ink">
            Live Sessions
          </h2>
        </div>

        <span className="rounded-full bg-ground-sunken px-3 py-1 text-[11px] font-semibold text-muted">
          {sessions.length} sessions
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {sessions.length > 0 ? (
          sessions.map((session) => {
            const active = session.status === 'active'
            const counts = session.counts || {}

            return (
              <div
                key={session.id}
                className="rounded-panel border border-line bg-ground p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">
                      Album: {session.album_id || '-'}
                    </p>

                    <p className="mt-1 text-[11px] font-semibold text-muted">
                      Resize: {(session.resize_mode || 'original').toUpperCase()}
                    </p>
                  </div>

                  <span
                    className={[
                      'shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase',
                      active
                        ? 'bg-gold text-ink'
                        : 'bg-white text-muted',
                    ].join(' ')}
                  >
                    {session.status || 'unknown'}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-panel bg-white p-3">
                    <p className="text-[10px] font-semibold uppercase text-muted">
                      Pending
                    </p>
                    <p className="mt-1 text-[20px] font-semibold text-ink">
                      {counts.pending || 0}
                    </p>
                  </div>

                  <div className="rounded-panel bg-white p-3">
                    <p className="text-[10px] font-semibold uppercase text-muted">
                      Active
                    </p>
                    <p className="mt-1 text-[20px] font-semibold text-ink">
                      {(counts.imported || 0) +
                        (counts.uploading || 0) +
                        (counts.finalizing || 0)}
                    </p>
                  </div>

                  <div className="rounded-panel bg-white p-3">
                    <p className="text-[10px] font-semibold uppercase text-muted">
                      Done
                    </p>
                    <p className="mt-1 text-[20px] font-semibold text-ink">
                      {counts.done || 0}
                    </p>
                  </div>
                </div>

                <div className="mt-3 text-[11px] font-semibold text-muted">
                  <p>
                    Latest:{' '}
                    {session.latest_import_filename || 'No import yet'}
                  </p>
                  <p>
                    Last activity:{' '}
                    {formatDate(
                      session.latest_import_at ||
                        session.last_activity_at ||
                        session.updated_at
                    )}
                  </p>
                </div>
              </div>
            )
          })
        ) : (
          <div className="rounded-panel bg-ground px-4 py-8 text-center">
            <p className="text-[13px] font-bold text-muted">
              No camera sessions found
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: string | number
  tone?: 'red' | 'blue' | 'green' | 'slate'
}) {
  const colorClass =
    tone === 'red'
      ? 'text-red-600'
      : tone === 'blue'
        ? 'text-blue-600'
        : tone === 'green'
          ? 'text-green-600'
          : 'text-ink'

  return (
    <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>

      <p className={`mt-2 text-3xl font-semibold ${colorClass}`}>{value}</p>
    </div>
  )
}

function WorkerCard({ workers }: { workers: WorkerHeartbeat[] }) {
  const onlineCount = workers.filter(isWorkerOnline).length

  return (
    <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Workers</h2>
          <p className="mt-1 text-xs text-muted">
            Online {onlineCount} / {workers.length}
          </p>
        </div>

        <div
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            workers.length > 0 && onlineCount === workers.length
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {workers.length > 0 && onlineCount === workers.length
            ? 'Online'
            : 'Check workers'}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {workers.length === 0 ? (
          <div className="rounded-panel bg-ground-sunken p-4 text-sm text-muted">
            No worker heartbeat found.
          </div>
        ) : (
          workers.map((worker) => {
            const online = isWorkerOnline(worker)

            return (
              <div
                key={worker.worker_id}
                className="rounded-panel bg-ground-sunken p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">
                      {worker.worker_name || worker.worker_id}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {worker.worker_type || '-'} • last seen{' '}
                      {formatDate(worker.last_seen_at || worker.last_seen)}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                      online
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {online ? 'online' : 'offline'}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function FailedJobsCard({
  title,
  jobs,
}: {
  title: string
  jobs: FailedJob[]
}) {
  return (
    <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
      <h2 className="text-lg font-bold text-ink">{title}</h2>

      <div className="mt-4 space-y-3">
        {jobs.length === 0 ? (
          <div className="rounded-panel bg-green-50 p-4 text-sm font-medium text-green-700">
            No recent failed jobs.
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="rounded-panel bg-red-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-red-800">
                    {job.id}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-red-700">
                    {job.error || 'Unknown error'}
                  </p>
                </div>

                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-red-700">
                  retry {job.retry_count || 0}
                </span>
              </div>

              <p className="mt-2 text-[11px] text-red-500">
                {formatDate(job.finished_at || job.started_at || job.created_at)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function RecentJobsCard({
  title,
  jobs,
}: {
  title: string
  jobs: FailedJob[]
}) {
  return (
    <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
      <h2 className="text-lg font-bold text-ink">{title}</h2>

      <div className="mt-4 space-y-3">
        {jobs.length === 0 ? (
          <div className="rounded-panel bg-ground-sunken p-4 text-sm text-muted">
            No recent jobs.
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="rounded-panel bg-ground-sunken p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-ink">
                    {job.id}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Photo: {job.photo_id || '-'}
                  </p>
                </div>

                <span className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase text-ink-soft">
                  {job.status || 'unknown'}
                </span>
              </div>

              <p className="mt-2 text-[11px] text-muted">
                {formatDate(job.finished_at || job.started_at || job.created_at)}
              </p>

              {job.error ? (
                <p className="mt-2 rounded-card bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
                  {job.error}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function RecentErrorsCard({ logs }: { logs: WorkerLog[] }) {
  return (
    <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
      <h2 className="text-lg font-bold text-ink">Recent Worker Errors</h2>

      <div className="mt-4 space-y-3">
        {logs.length === 0 ? (
          <div className="rounded-panel bg-green-50 p-4 text-sm font-medium text-green-700">
            No recent worker errors.
          </div>
        ) : (
          logs.map((log, index) => (
            <div
              key={log.id || `${log.created_at}-${index}`}
              className="rounded-panel bg-ground-sunken p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  {log.worker_type || 'worker'} / {log.level || 'error'}
                </p>

                <p className="shrink-0 text-[11px] text-muted">
                  {formatDate(log.created_at)}
                </p>
              </div>

              <p className="mt-2 line-clamp-3 text-sm text-ink-soft">
                {log.message || 'Unknown error'}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function WorkerTimeline({ logs }: { logs: WorkerLog[] }) {
  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Activity
          </p>

          <h2 className="mt-1 text-[22px] font-semibold text-ink">
            Worker Timeline
          </h2>
        </div>

        <span className="rounded-full bg-green-50 px-3 py-1 text-[11px] font-semibold text-green-700">
          LIVE
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {logs.length === 0 ? (
          <div className="rounded-panel bg-ground p-6 text-center text-muted">
            No activity
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={log.id || index} className="flex gap-3">
              <div className="mt-1 h-2.5 w-2.5 rounded-full bg-green-500" />

              <div className="flex-1 rounded-panel bg-ground p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-semibold text-ink">
                    {log.worker_type || 'worker'}
                  </p>

                  <span className="shrink-0 text-[11px] text-muted">
                    {formatDate(log.created_at)}
                  </span>
                </div>

                <p className="mt-2 line-clamp-3 text-[12px] text-[#555]">
                  {log.message || 'No message'}
                </p>

                {log.photo_id || log.album_id ? (
                  <p className="mt-2 truncate text-[10px] font-semibold text-muted">
                    {log.photo_id ? `Photo: ${log.photo_id}` : ''}
                    {log.photo_id && log.album_id ? ' · ' : ''}
                    {log.album_id ? `Album: ${log.album_id}` : ''}
                  </p>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default function AdminQueueDashboard() {
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')

  const loadingRef = useRef(false)

  const systemStatus = useMemo(() => {
    if (!stats) return 'loading'

    const failedPhoto = stats.photoJobs.failed || 0
    const failedFace = stats.faceJobs.failed || 0
    const workers = stats.workers || []
    const hasOfflineWorker =
      workers.length > 0 && workers.some((worker) => !isWorkerOnline(worker))

    if (failedPhoto > 0 || failedFace > 0 || hasOfflineWorker) return 'warning'

    return 'healthy'
  }, [stats])

  const totalFailed =
  (stats?.photoJobs?.failed || 0) +
  (stats?.faceJobs?.failed || 0) +
  (stats?.cameraJobs?.failed || 0)

const totalProcessing =
  (stats?.photoJobs?.processing || 0) +
  (stats?.faceJobs?.processing || 0) +
  (stats?.cameraJobs?.uploading || 0) +
  (stats?.cameraJobs?.finalizing || 0) +
  (stats?.cameraJobs?.imported || 0) +
  (stats?.cameraJobs?.pending || 0)

  const onlineWorkers = stats?.workers?.filter(isWorkerOnline).length || 0
  const totalWorkers = stats?.workers?.length || 0

  async function loadStats(silent = false) {
    try {
      if (!silent) setRefreshing(true)

      const res = await fetch('/api/worker/queue-stats', {
        cache: 'no-store',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || 'Cannot load queue stats')
      }

      setStats(data)
    } catch {
      setStats(null)
    } finally {
      if (!silent) setRefreshing(false)
    }
  }

  async function runAction(action: string) {
    try {
      setLoading(true)
      setMessage('')

      const res = await fetch('/api/worker/queue-actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || 'Action failed')
      }

      setMessage(`${action} success (${data.count || 0})`)

      await loadStats(true)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Queue action failed'
      )
    } finally {
      setLoading(false)
    }
  }

  async function runCleanup(dryRun: boolean) {
    try {
      const confirmed =
        dryRun ||
        window.confirm(
          'Delete orphan storage files? This will remove files not referenced in the photos table.'
        )

      if (!confirmed) return

      setLoading(true)
      setMessage('')
      setCleanupResult(null)

      const res = await fetch('/api/storage/cleanup-orphan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dryRun,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || 'Cleanup failed')
      }

      setCleanupResult(data)

      setMessage(
        dryRun
          ? `Scan complete: found ${data.orphanCount} orphan file(s)`
          : `Delete complete: deleted ${data.deletedCount} orphan file(s)`
      )

      await loadStats(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cleanup failed')
    } finally {
      setLoading(false)
    }
  }

useEffect(() => {
  async function fetchStats() {
    if (document.hidden) {
      return
    }

    if (loadingRef.current) {
      return
    }

    try {
      loadingRef.current = true

      const res = await fetch('/api/worker/queue-stats', {
        cache: 'no-store',
      })

      if (!res.ok) {
        return
      }

      const data = await res.json()

      setStats(data)
    } catch (error) {
      console.error(error)
    } finally {
      loadingRef.current = false
    }
  }

  fetchStats()

  const interval = setInterval(fetchStats, 5000)

  return () => {
    clearInterval(interval)
  }
}, [])


  return (
    <main className="min-h-screen bg-ground-sunken px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted">
              Ciiya Admin
            </p>

            <h1 className="mt-2 text-3xl font-semibold text-ink">
              Queue Dashboard
            </h1>

            <div
              className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                systemStatus === 'healthy'
                  ? 'bg-green-100 text-green-700'
                  : systemStatus === 'warning'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-ground-sunken text-muted'
              }`}
            >
              {systemStatus === 'healthy'
                ? 'System Healthy'
                : systemStatus === 'warning'
                  ? 'Needs Attention'
                  : 'Loading'}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={refreshing || loading}
              onClick={() => loadStats()}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm ring-1 ring-line disabled:opacity-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>

            <Link
              href="/albums"
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm ring-1 ring-line"
            >
              Albums
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <SummaryCard label="Failed Jobs" value={totalFailed} tone="red" />
          <SummaryCard
            label="Processing"
            value={totalProcessing}
            tone="blue"
          />
          <SummaryCard
            label="Workers"
            value={`${onlineWorkers}/${totalWorkers}`}
            tone="green"
          />
          <SummaryCard
            label="Last Update"
            value={stats ? formatDate(stats.checkedAt) : '-'}
            tone="slate"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <button
            disabled={loading}
            onClick={() => runAction('reset_stuck_photo_jobs')}
            className="rounded-card border border-line-strong bg-surface px-4 py-3 text-sm font-semibold text-ink transition hover:bg-ground-sunken disabled:opacity-50"
          >
            Reset Stuck Photo Jobs
          </button>

          <button
            disabled={loading}
            onClick={() => runAction('reset_stuck_face_jobs')}
            className="rounded-card border border-line-strong bg-surface px-4 py-3 text-sm font-semibold text-ink transition hover:bg-ground-sunken disabled:opacity-50"
          >
            Reset Stuck Face Jobs
          </button>

          <button
            disabled={loading}
            onClick={() => runAction('retry_failed_photo_jobs')}
            className="rounded-card border border-line-strong bg-surface px-4 py-3 text-sm font-semibold text-ink transition hover:bg-ground-sunken disabled:opacity-50"
          >
            Retry Failed Photo Jobs
          </button>

          <button
            disabled={loading}
            onClick={() => runAction('retry_failed_face_jobs')}
            className="rounded-card border border-line-strong bg-surface px-4 py-3 text-sm font-semibold text-ink transition hover:bg-ground-sunken disabled:opacity-50"
          >
            Retry Failed Face Jobs
          </button>
        </div>

        <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
          <h2 className="text-lg font-bold text-ink">
            Storage Cleanup
          </h2>

          <p className="mt-1 text-sm text-muted">
            Scan and remove files in Supabase Storage that are no longer linked
            to any photo record.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <button
              disabled={loading}
              onClick={() => runCleanup(true)}
              className="rounded-card bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:opacity-50"
            >
              Scan Orphan Files
            </button>

            <button
              disabled={loading}
              onClick={() => runCleanup(false)}
              className="rounded-card bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              Delete Orphan Files
            </button>
          </div>

          {cleanupResult ? (
            <div className="mt-4 rounded-panel bg-ground-sunken p-4 text-sm text-ink-soft">
              <div className="grid gap-2 md:grid-cols-4">
                <div>
                  <p className="text-xs text-muted">Scanned</p>
                  <p className="font-bold text-ink">
                    {cleanupResult.scanned}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted">Used</p>
                  <p className="font-bold text-ink">
                    {cleanupResult.used}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted">Orphan</p>
                  <p className="font-bold text-red-600">
                    {cleanupResult.orphanCount}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted">Deleted</p>
                  <p className="font-bold text-ink">
                    {cleanupResult.deletedCount}
                  </p>
                </div>
              </div>

              {cleanupResult.sample?.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-muted">
                    Sample orphan files
                  </p>

                  <div className="mt-2 max-h-40 overflow-y-auto rounded-card bg-white p-3 text-xs text-muted">
                    {cleanupResult.sample.map((item) => (
                      <p key={item} className="truncate">
                        {item}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {message ? (
          <div className="rounded-panel bg-white p-4 text-sm font-medium text-ink-soft shadow-sm ring-1 ring-line">
            {message}
          </div>
        ) : null}

        {!stats ? (
          <div className="rounded-panel bg-white p-6 text-center text-sm text-red-500 shadow-sm ring-1 ring-line">
            Cannot load queue stats.
          </div>
        ) : (
         <>
  <LiveAlertCard stats={stats} />
  <SystemOverviewCard stats={stats} />
  <LivePerformanceCard stats={stats} />
  <PerformanceAnalyticsCard data={stats.performanceAnalytics} />
  <UploadRecoveryWatchCard data={stats.uploadRecoveryWatch} />
  <WorkerHealthSummary stats={stats} />
            <div className="rounded-panel bg-white p-4 text-sm text-muted shadow-sm ring-1 ring-line">
              Last checked:{' '}
              <span className="font-semibold text-ink">
                {formatDate(stats.checkedAt)}
              </span>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
  <QueueCard title="Photo Resize Queue" data={stats.photoJobs} />
  <QueueCard title="Face Scan Queue" data={stats.faceJobs} />
  <QueueCard title="Camera Import Queue" data={stats.cameraJobs || {}} />
</div>

<RecentCameraImports items={stats.recentCameraImports || []} />

<CameraSessionMonitor sessions={stats.cameraSessions || []} />

<div className="grid gap-5 lg:grid-cols-2">
  <RecentJobsCard
    title="Recent Photo Jobs"
    jobs={stats.recentPhotoJobs || []}
  />

  <RecentJobsCard
    title="Recent Face Jobs"
    jobs={stats.recentFaceJobs || []}
  />
</div>

<WorkerCard workers={stats.workers || []} />

            <div className="grid gap-5 lg:grid-cols-2">
              <FailedJobsCard
                title="Recent Failed Photo Jobs"
                jobs={stats.failedPhotoJobs || []}
              />
              <FailedJobsCard
                title="Recent Failed Face Jobs"
                jobs={stats.failedFaceJobs || []}
              />
            </div>

            <RecentErrorsCard logs={stats.recentErrors || []} />
            <WorkerTimeline logs={stats.recentTimeline || []} />
          </>
        )}
      </div>
    </main>
  )
}