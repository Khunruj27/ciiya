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
  workers?: WorkerHeartbeat[]
  recentErrors?: WorkerLog[]
  failedPhotoJobs?: FailedJob[]
  failedFaceJobs?: FailedJob[]
  checkedAt: string
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
    <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs text-slate-400">Total jobs: {total}</p>
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
        <div className="rounded-2xl bg-yellow-50 p-4">
          <p className="text-xs font-medium text-yellow-700">Pending</p>
          <p className="mt-1 text-2xl font-black text-yellow-800">
            {pending}
          </p>
        </div>

        <div className="rounded-2xl bg-blue-50 p-4">
          <p className="text-xs font-medium text-blue-700">Processing</p>
          <p className="mt-1 text-2xl font-black text-blue-800">
            {processing}
          </p>
        </div>

        <div className="rounded-2xl bg-green-50 p-4">
          <p className="text-xs font-medium text-green-700">Done</p>
          <p className="mt-1 text-2xl font-black text-green-800">{done}</p>
        </div>

        <div className="rounded-2xl bg-red-50 p-4">
          <p className="text-xs font-medium text-red-700">Failed</p>
          <p className="mt-1 text-2xl font-black text-red-800">{failed}</p>
        </div>
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
          : 'text-slate-800'

  return (
    <div className="rounded-[24px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className={`mt-2 text-3xl font-black ${colorClass}`}>{value}</p>
    </div>
  )
}

function WorkerCard({ workers }: { workers: WorkerHeartbeat[] }) {
  const onlineCount = workers.filter(isWorkerOnline).length

  return (
    <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Workers</h2>
          <p className="mt-1 text-xs text-slate-400">
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
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
            No worker heartbeat found.
          </div>
        ) : (
          workers.map((worker) => {
            const online = isWorkerOnline(worker)

            return (
              <div
                key={worker.worker_id}
                className="rounded-2xl bg-slate-50 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {worker.worker_name || worker.worker_id}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
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
    <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>

      <div className="mt-4 space-y-3">
        {jobs.length === 0 ? (
          <div className="rounded-2xl bg-green-50 p-4 text-sm font-medium text-green-700">
            No recent failed jobs.
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="rounded-2xl bg-red-50 p-4">
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

function RecentErrorsCard({ logs }: { logs: WorkerLog[] }) {
  return (
    <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="text-lg font-bold text-slate-900">Recent Worker Errors</h2>

      <div className="mt-4 space-y-3">
        {logs.length === 0 ? (
          <div className="rounded-2xl bg-green-50 p-4 text-sm font-medium text-green-700">
            No recent worker errors.
          </div>
        ) : (
          logs.map((log, index) => (
            <div
              key={log.id || `${log.created_at}-${index}`}
              className="rounded-2xl bg-slate-50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {log.worker_type || 'worker'} / {log.level || 'error'}
                </p>

                <p className="shrink-0 text-[11px] text-slate-400">
                  {formatDate(log.created_at)}
                </p>
              </div>

              <p className="mt-2 line-clamp-3 text-sm text-slate-700">
                {log.message || 'Unknown error'}
              </p>
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
    (stats?.photoJobs?.failed || 0) + (stats?.faceJobs?.failed || 0)

  const totalProcessing =
    (stats?.photoJobs?.processing || 0) + (stats?.faceJobs?.processing || 0)

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
    <main className="min-h-screen bg-[#F8F9FC] px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
              Ciiya Admin
            </p>

            <h1 className="mt-2 text-3xl font-black text-slate-950">
              Queue Dashboard
            </h1>

            <div
              className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                systemStatus === 'healthy'
                  ? 'bg-green-100 text-green-700'
                  : systemStatus === 'warning'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-slate-100 text-slate-500'
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
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-black/5 disabled:opacity-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>

            <Link
              href="/albums"
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-black/5"
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
            className="rounded-2xl bg-yellow-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            Reset Stuck Photo Jobs
          </button>

          <button
            disabled={loading}
            onClick={() => runAction('reset_stuck_face_jobs')}
            className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            Reset Stuck Face Jobs
          </button>

          <button
            disabled={loading}
            onClick={() => runAction('retry_failed_photo_jobs')}
            className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            Retry Failed Photo Jobs
          </button>

          <button
            disabled={loading}
            onClick={() => runAction('retry_failed_face_jobs')}
            className="rounded-2xl bg-purple-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            Retry Failed Face Jobs
          </button>
        </div>

        <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="text-lg font-bold text-slate-900">
            Storage Cleanup
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Scan and remove files in Supabase Storage that are no longer linked
            to any photo record.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <button
              disabled={loading}
              onClick={() => runCleanup(true)}
              className="rounded-2xl bg-slate-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Scan Orphan Files
            </button>

            <button
              disabled={loading}
              onClick={() => runCleanup(false)}
              className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Delete Orphan Files
            </button>
          </div>

          {cleanupResult ? (
            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <div className="grid gap-2 md:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-400">Scanned</p>
                  <p className="font-bold text-slate-900">
                    {cleanupResult.scanned}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-400">Used</p>
                  <p className="font-bold text-slate-900">
                    {cleanupResult.used}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-400">Orphan</p>
                  <p className="font-bold text-red-600">
                    {cleanupResult.orphanCount}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-400">Deleted</p>
                  <p className="font-bold text-slate-900">
                    {cleanupResult.deletedCount}
                  </p>
                </div>
              </div>

              {cleanupResult.sample?.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-slate-500">
                    Sample orphan files
                  </p>

                  <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-white p-3 text-xs text-slate-500">
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
          <div className="rounded-2xl bg-white p-4 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-black/5">
            {message}
          </div>
        ) : null}

        {!stats ? (
          <div className="rounded-[28px] bg-white p-6 text-center text-sm text-red-500 shadow-sm ring-1 ring-black/5">
            Cannot load queue stats.
          </div>
        ) : (
          <>
            <div className="rounded-[24px] bg-white p-4 text-sm text-slate-500 shadow-sm ring-1 ring-black/5">
              Last checked:{' '}
              <span className="font-semibold text-slate-800">
                {formatDate(stats.checkedAt)}
              </span>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <QueueCard title="Photo Resize Queue" data={stats.photoJobs} />
              <QueueCard title="Face Scan Queue" data={stats.faceJobs} />
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
          </>
        )}
      </div>
    </main>
  )
}