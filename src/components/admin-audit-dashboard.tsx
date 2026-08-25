'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AlertCenter from '@/components/admin/AlertCenter'
import StorageAnalyticsCard from '@/components/admin/StorageAnalyticsCard'
import MonitoringOverviewCard from '@/components/admin/MonitoringOverviewCard'

type AuditPayload = {
  success: boolean
  overall: {
    status: string
    issueCount: number
  }
  upload: {
    photos: {
      total: number
      stuck: number
      failed: number
    }
    jobs: {
      total: number
      byStatus: Record<string, number>
      stuck: number
    }
  }
  face: {
    total: number
    byStatus: Record<string, number>
    stuck: number
  }
  camera: {
    imports: {
      total: number
      byStatus: Record<string, number>
    }
    sessions: {
      total: number
      active: number
    }
  }
  monitoring: {
  liveActivity: {
    photosToday: number
    cameraImportsToday: number
    uploadsLastHour: number
    cameraImportsLastHour: number
  }

  throughput: {
    photoJobsLastHour: number
    faceJobsLastHour: number
    totalJobsLastHour: number
  }

  slowJobs: {
    id: string
    type: string
    seconds: number
    status: string
  }[]

  queueHeatmap: {
    photo: Record<string, number>
    face: Record<string, number>
    camera: Record<string, number>
  }
}
  workers: {
    total: number
    online: number
    offline: number
    items: {
      worker_id: string
      worker_name?: string | null
      worker_type?: string | null
      status?: string | null
      last_seen?: string | null
      last_seen_at?: string | null
      updated_at?: string | null
    }[]
  }
  storage: {
    totalUsers: number
    warningUsers: number
    dangerUsers: number
  }
  dataIntegrity: {
    duplicateHashCount: number
    jobsWithoutPhoto: number
    faceJobsWithoutPhoto: number
  }
  logs: {
    recentErrors: {
      id: string
      worker_type?: string | null
      level?: string | null
      message?: string | null
      created_at?: string | null
    }[]
  }
  storageAnalytics: {
  totalUsers: number
  totalStorageUsed: number
  totalStorageLimit: number
  averageStorage: number
  topUsers: {
    userId: string
    usedBytes: number
    limitBytes: number
    percent: number
    plan: string
  }[]
}
  checkedAt: string
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function HealthCard({
  title,
  status,
  detail,
  tone = 'ok',
}: {
  title: string
  status: string
  detail: string
  tone?: 'ok' | 'warning' | 'danger'
}) {
  return (
    <div className="rounded-panel border border-line bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            {title}
          </p>

          <p className="mt-2 text-[24px] font-semibold tracking-[-0.04em] text-ink">
            {status}
          </p>

          <p className="mt-1 text-[12px] font-semibold text-muted">
            {detail}
          </p>
        </div>

        <span
          className={[
            'mt-1 h-3 w-3 rounded-full',
            tone === 'danger'
              ? 'bg-red-500'
              : tone === 'warning'
                ? 'bg-yellow-500'
                : 'bg-green-500',
          ].join(' ')}
        />
      </div>
    </div>
  )
}

function getStatusTone(hasDanger: boolean, hasWarning = false) {
  if (hasDanger) return 'danger'
  if (hasWarning) return 'warning'
  return 'ok'
}

export default function AdminAuditDashboard() {
  const [data, setData] = useState<AuditPayload | null>(null)
  const [loading, setLoading] = useState(false)

  async function loadAudit() {
    try {
      setLoading(true)

      const res = await fetch('/api/admin/audit', {
        cache: 'no-store',
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || 'Cannot load audit')
      }

      setData(json)
    } catch (error) {
      console.error(error)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

 useEffect(() => {
  const run = () => {
    void loadAudit()
  }

  window.setTimeout(run, 0)

  const timer = window.setInterval(run, 5000)

  return () => {
    window.clearInterval(timer)
  }
}, [])

  const overallScore = useMemo(() => {
    if (!data) return 0

    return Math.max(0, Math.min(100, 100 - data.overall.issueCount * 2))
  }, [data])

  return (
    <main className="min-h-screen bg-ground-sunken px-4 py-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted">
              Ciiya Admin
            </p>

            <h1 className="mt-2 text-3xl font-semibold text-ink">
              Production Audit
            </h1>

            <p className="mt-2 text-sm font-medium text-muted">
              Read-only system health check for upload, queue, camera, worker,
              storage and data integrity.
            </p>
          </div>

          <div className="flex gap-2">
            <div className="flex items-center gap-2 rounded-full bg-green-50 px-3 py-2">
    <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />

    <span className="text-xs font-semibold uppercase text-green-700">
        Live
    </span>
</div>

            <button
              type="button"
              onClick={loadAudit}
              disabled={loading}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm ring-1 ring-line disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>

            

            <Link
              href="/admin/users"
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm ring-1 ring-line"
            >
              Users
            </Link>

            <Link
              href="/admin/queue"
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm ring-1 ring-line"
            >
              Queue
            </Link>
          </div>
        </div>

        {!data ? (
          <div className="rounded-panel bg-white p-6 text-center text-sm text-red-500 shadow-sm ring-1 ring-line">
            Cannot load production audit.
          </div>
        ) : (
          <>
            <div className="rounded-hero border border-line bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Overall
                  </p>

                  <h2 className="mt-1 text-[30px] font-semibold tracking-[-0.06em] text-ink">
                    {data.overall.status === 'healthy'
                      ? 'System Healthy'
                      : 'Needs Attention'}
                  </h2>

                  <p className="mt-2 text-sm font-semibold text-muted">
                    Issues detected: {data.overall.issueCount}
                  </p>
                </div>


                <div className="text-left md:text-right">
                  <p
                    className={[
                      'text-[42px] font-semibold tracking-[-0.08em]',
                      overallScore >= 90
                        ? 'text-green-600'
                        : overallScore >= 70
                          ? 'text-yellow-600'
                          : 'text-red-600',
                    ].join(' ')}
                  >
                    {overallScore}%
                  </p>

                  <p className="text-xs font-semibold uppercase text-muted">
                    Audit Score
                  </p>
                </div>
              </div>

              <div className="mt-5 h-3 overflow-hidden rounded-full bg-ground">
                <div
                  className={[
                    'h-full rounded-full',
                    overallScore >= 90
                      ? 'bg-green-500'
                      : overallScore >= 70
                        ? 'bg-yellow-500'
                        : 'bg-red-500',
                  ].join(' ')}
                  style={{ width: `${overallScore}%` }}
                />
              </div>

              <div className="mt-4 space-y-1">
  <p className="text-xs font-semibold text-muted">
    Last checked: {formatDate(data.checkedAt)}
  </p>
</div>
              <p className="text-xs text-muted">
    Auto refresh every 5 seconds
</p>
            </div>

             <AlertCenter data={data} />
             <StorageAnalyticsCard data={data.storageAnalytics} />
             <MonitoringOverviewCard data={data.monitoring} />

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <HealthCard
                title="Upload"
                status={
                  data.upload.jobs.byStatus.failed > 0 ||
                  data.upload.photos.failed > 0
                    ? 'Check'
                    : 'Healthy'
                }
                detail={`Jobs ${data.upload.jobs.total}, stuck ${data.upload.jobs.stuck}, failed ${data.upload.photos.failed}`}
                tone={getStatusTone(
                  data.upload.jobs.byStatus.failed > 0 ||
                    data.upload.photos.failed > 0,
                  data.upload.jobs.stuck > 0 || data.upload.photos.stuck > 0
                )}
              />

              <HealthCard
                title="Face AI"
                status={data.face.byStatus.failed > 0 ? 'Check' : 'Healthy'}
                detail={`Jobs ${data.face.total}, stuck ${data.face.stuck}`}
                tone={getStatusTone(
                  data.face.byStatus.failed > 0,
                  data.face.stuck > 0
                )}
              />

              <HealthCard
                title="Camera"
                status={
                  data.camera.imports.byStatus.failed > 0
                    ? 'Check'
                    : 'Healthy'
                }
                detail={`Imports ${data.camera.imports.total}, active sessions ${data.camera.sessions.active}`}
                tone={getStatusTone(
                  data.camera.imports.byStatus.failed > 0,
                  data.camera.sessions.active > 0
                )}
              />

              <HealthCard
                title="Workers"
                status={
                  data.workers.offline > 0
                    ? 'Offline'
                    : `${data.workers.online}/${data.workers.total}`
                }
                detail={`${data.workers.online} online, ${data.workers.offline} offline`}
                tone={getStatusTone(data.workers.offline > 0)}
              />

              <HealthCard
                title="Storage"
                status={
                  data.storage.dangerUsers > 0
                    ? 'Danger'
                    : data.storage.warningUsers > 0
                      ? 'Watch'
                      : 'Healthy'
                }
                detail={`${data.storage.warningUsers} warning, ${data.storage.dangerUsers} danger`}
                tone={getStatusTone(
                  data.storage.dangerUsers > 0,
                  data.storage.warningUsers > 0
                )}
              />

              <HealthCard
                title="Duplicate"
                status={
                  data.dataIntegrity.duplicateHashCount > 0 ? 'Check' : 'Clear'
                }
                detail={`${data.dataIntegrity.duplicateHashCount} duplicate hash group(s)`}
                tone={getStatusTone(
                  data.dataIntegrity.duplicateHashCount > 0
                )}
              />

              <HealthCard
                title="Orphan Jobs"
                status={
                  data.dataIntegrity.jobsWithoutPhoto > 0 ||
                  data.dataIntegrity.faceJobsWithoutPhoto > 0
                    ? 'Check'
                    : 'Clear'
                }
                detail={`${data.dataIntegrity.jobsWithoutPhoto} photo jobs, ${data.dataIntegrity.faceJobsWithoutPhoto} face jobs`}
                tone={getStatusTone(
                  data.dataIntegrity.jobsWithoutPhoto > 0 ||
                    data.dataIntegrity.faceJobsWithoutPhoto > 0
                )}
              />

              <HealthCard
                title="Logs"
                status={
                  data.logs.recentErrors.length > 0 ? 'Errors' : 'Clear'
                }
                detail={`${data.logs.recentErrors.length} recent error log(s)`}
                tone={getStatusTone(data.logs.recentErrors.length > 0)}
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
                <h2 className="text-lg font-bold text-ink">
                  Recent Error Logs
                </h2>

                <div className="mt-4 space-y-3">
                  {data.logs.recentErrors.length > 0 ? (
                    data.logs.recentErrors.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-panel bg-red-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-xs font-semibold uppercase text-red-700">
                            {log.worker_type || 'worker'} /{' '}
                            {log.level || 'error'}
                          </p>

                          <span className="text-[11px] font-semibold text-red-500">
                            {formatDate(log.created_at)}
                          </span>
                        </div>

                        <p className="mt-2 line-clamp-3 text-sm font-semibold text-red-700">
                          {log.message || 'Unknown error'}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-panel bg-green-50 p-4 text-sm font-semibold text-green-700">
                      No recent error logs.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
                <h2 className="text-lg font-bold text-ink">
                  Worker Heartbeats
                </h2>

                <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto">
                  {data.workers.items.length > 0 ? (
                    data.workers.items.map((worker) => (
                      <div
                        key={worker.worker_id}
                        className="rounded-panel bg-ground p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">
                              {worker.worker_name || worker.worker_id}
                            </p>

                            <p className="mt-1 text-xs font-semibold text-muted">
                              {worker.worker_type || '-'} ·{' '}
                              {formatDate(
                                worker.last_seen_at ||
                                  worker.last_seen ||
                                  worker.updated_at
                              )}
                            </p>
                          </div>

                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase text-ink-soft">
                            {worker.status || 'unknown'}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-panel bg-yellow-50 p-4 text-sm font-semibold text-yellow-700">
                      No worker heartbeats.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}