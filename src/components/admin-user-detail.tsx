'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

type UserDetailPayload = {
  success: boolean
  profile: {
    id: string
    email: string | null
    name: string
    status: string
    plan: string
    subscriptionStatus: string
    createdAt: string | null
    lastLoginAt: string | null
    lastActiveAt: string | null
    lastUploadAt: string | null
    storageUsedBytes: number
    storageLimitBytes: number
    albumCount: number
    photoCount: number
  }
  albums: {
    id: string
    title: string
    description: string | null
    coverUrl: string | null
    photoCount: number
    createdAt: string | null
    updatedAt: string | null
  }[]
  recentUploads: {
    id: string
    albumId: string | null
    filename: string
    previewUrl: string | null
    status: string
    fileSizeBytes: number
    createdAt: string | null
  }[]
  jobs: {
    pending: number
    processing: number
    failed: number
    done: number
  }
  camera: {
    sessions: {
      id: string
      album_id: string | null
      status: string | null
      resize_mode: string | null
      created_at: string | null
      updated_at: string | null
      last_activity_at: string | null
    }[]
    recentImports: {
      id: string
      filename: string | null
      status: string | null
      progress: number | null
      created_at: string | null
    }[]
  }
    timeline?: {
    id: string
    type: string
    title: string
    description: string
    createdAt: string | null
  }[]
  checkedAt: string
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatBytes(bytes?: number | null) {
  const value = Number(bytes || 0)

  if (value < 1024) return `${value} B`

  const kb = value / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`

  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`

  const gb = mb / 1024
  if (gb < 1024) return `${gb.toFixed(2)} GB`

  return `${(gb / 1024).toFixed(2)} TB`
}

function getStorageRisk(profile: UserDetailPayload['profile']) {
  if (!profile.storageLimitBytes || profile.storageLimitBytes <= 0) {
    return {
      label: 'No limit',
      level: 'safe',
    }
  }

  const percent = Math.round(
    (profile.storageUsedBytes / profile.storageLimitBytes) * 100
  )

  if (percent >= 90) {
    return {
      label: 'High risk',
      level: 'danger',
    }
  }

  if (percent >= 70) {
    return {
      label: 'Watch',
      level: 'warning',
    }
  }

  return {
    label: 'Safe',
    level: 'safe',
  }
}

function getUserActivityLevel(profile: UserDetailPayload['profile']) {
  if (!profile.lastActiveAt) return 'inactive'

  const ageMs = Date.now() - new Date(profile.lastActiveAt).getTime()
  const days = ageMs / (24 * 60 * 60 * 1000)

  if (days <= 1) return 'active today'
  if (days <= 7) return 'active 7d'
  if (days <= 30) return 'active 30d'

  return 'inactive'
}

function getUserHealth(params: {
  profile: UserDetailPayload['profile']
  jobs: UserDetailPayload['jobs']
  storageRisk: {
    label: string
    level: string
  } | null
  cameraImports: UserDetailPayload['camera']['recentImports']
}) {
  const issues: string[] = []
  let score = 100

  if (params.profile.status !== 'active') {
    issues.push('User is not active')
    score -= 20
  }

  if (params.storageRisk?.level === 'warning') {
    issues.push('Storage usage is high')
    score -= 10
  }

  if (params.storageRisk?.level === 'danger') {
    issues.push('Storage is near full')
    score -= 25
  }

  if (params.jobs.failed > 0) {
    issues.push(`${params.jobs.failed} failed job(s)`)
    score -= Math.min(30, params.jobs.failed * 10)
  }

  if (params.jobs.pending > 10) {
    issues.push(`${params.jobs.pending} pending job(s)`)
    score -= 10
  }

  if (params.jobs.processing > 10) {
    issues.push(`${params.jobs.processing} running job(s)`)
    score -= 10
  }

  const hasRecentCameraFailed = params.cameraImports.some(
    (item) => item.status === 'failed'
  )

  if (hasRecentCameraFailed) {
    issues.push('Recent camera import failed')
    score -= 15
  }

  const safeScore = Math.max(0, Math.min(100, score))

  return {
    score: safeScore,
    label:
      safeScore >= 90
        ? 'Excellent'
        : safeScore >= 70
          ? 'Good'
          : safeScore >= 50
            ? 'Warning'
            : 'Needs attention',
    issues,
  }
}

function getUserDiagnostics(params: {
  profile: UserDetailPayload['profile']
  jobs: UserDetailPayload['jobs']
  storageRisk: {
    label: string
    level: string
  } | null
  cameraImports: UserDetailPayload['camera']['recentImports']
}) {
  const diagnostics: {
    label: string
    status: 'ok' | 'warning' | 'danger'
    detail: string
  }[] = []

  diagnostics.push({
    label: 'Account',
    status: params.profile.status === 'active' ? 'ok' : 'warning',
    detail:
      params.profile.status === 'active'
        ? 'Active user'
        : 'No recent activity',
  })

  diagnostics.push({
    label: 'Storage',
    status:
      params.storageRisk?.level === 'danger'
        ? 'danger'
        : params.storageRisk?.level === 'warning'
          ? 'warning'
          : 'ok',
    detail: params.storageRisk?.label || 'Safe',
  })

  diagnostics.push({
    label: 'Queue',
    status:
      params.jobs.failed > 0
        ? 'danger'
        : params.jobs.pending > 10 || params.jobs.processing > 10
          ? 'warning'
          : 'ok',
    detail:
      params.jobs.failed > 0
        ? `${params.jobs.failed} failed job(s)`
        : params.jobs.pending > 10
          ? `${params.jobs.pending} pending job(s)`
          : params.jobs.processing > 10
            ? `${params.jobs.processing} running job(s)`
            : 'Clear',
  })

  const cameraFailed = params.cameraImports.some(
    (item) => item.status === 'failed'
  )

  const cameraRunning = params.cameraImports.some((item) =>
    ['pending', 'imported', 'uploading', 'finalizing'].includes(
      String(item.status || '')
    )
  )

  diagnostics.push({
    label: 'Camera',
    status: cameraFailed ? 'danger' : cameraRunning ? 'warning' : 'ok',
    detail: cameraFailed
      ? 'Import failed'
      : cameraRunning
        ? 'Import running'
        : 'Healthy',
  })

  const lastUpload = params.profile.lastUploadAt
    ? new Date(params.profile.lastUploadAt).getTime()
    : null

  const daysSinceUpload =
    lastUpload && Number.isFinite(lastUpload)
      ? (Date.now() - lastUpload) / (24 * 60 * 60 * 1000)
      : null

  diagnostics.push({
    label: 'Upload',
    status:
      daysSinceUpload === null
        ? 'warning'
        : daysSinceUpload <= 1
          ? 'ok'
          : daysSinceUpload <= 7
            ? 'warning'
            : 'danger',
    detail:
      daysSinceUpload === null
        ? 'No upload yet'
        : daysSinceUpload <= 1
          ? 'Uploaded today'
          : daysSinceUpload <= 7
            ? 'Uploaded this week'
            : 'No recent upload',
  })

  const lastLogin = params.profile.lastLoginAt
    ? new Date(params.profile.lastLoginAt).getTime()
    : null

  const daysSinceLogin =
    lastLogin && Number.isFinite(lastLogin)
      ? (Date.now() - lastLogin) / (24 * 60 * 60 * 1000)
      : null

  diagnostics.push({
    label: 'Login',
    status:
      daysSinceLogin === null
        ? 'warning'
        : daysSinceLogin <= 7
          ? 'ok'
          : daysSinceLogin <= 30
            ? 'warning'
            : 'danger',
    detail:
      daysSinceLogin === null
        ? 'No login record'
        : daysSinceLogin <= 1
          ? 'Logged in today'
          : daysSinceLogin <= 7
            ? 'Logged in this week'
            : daysSinceLogin <= 30
              ? 'Logged in this month'
              : 'No recent login',
  })

  return diagnostics
}

function StatCard({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-panel border border-line bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </p>

      <p className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-ink">
        {value}
      </p>
    </div>
  )
}

function UserTimeline({
  items = [],
}: {
  items?: NonNullable<UserDetailPayload['timeline']>
}) {
  function getDotClass(type: string) {
    if (type === 'upload') return 'bg-green-500'
    if (type === 'camera') return 'bg-blue-500'
    if (type === 'face_job') return 'bg-purple-500'
    if (type === 'photo_job') return 'bg-yellow-500'
    if (type === 'login') return 'bg-ink-soft'
    return 'bg-gold'
  }

  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Activity
          </p>

          <h2 className="mt-1 text-[24px] font-semibold text-ink">
            Recent User Timeline
          </h2>
        </div>

        <span className="rounded-full bg-ground-sunken px-3 py-1 text-[11px] font-semibold text-muted">
          {items.length} events
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item.id} className="flex gap-3">
              <div
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${getDotClass(
                  item.type
                )}`}
              />

              <div className="flex-1 rounded-panel bg-ground p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">
                      {item.title}
                    </p>

                    <p className="mt-1 line-clamp-2 text-[12px] font-semibold text-muted">
                      {item.description}
                    </p>
                  </div>

                  <span className="shrink-0 text-[11px] font-semibold text-muted">
                    {formatDate(item.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-panel bg-ground px-4 py-8 text-center">
            <p className="text-[13px] font-bold text-muted">
              No recent activity
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function UserDiagnosticsCard({
  items,
}: {
  items: ReturnType<typeof getUserDiagnostics>
}) {
  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Support
          </p>

          <h2 className="mt-1 text-[24px] font-semibold text-ink">
            Diagnostics
          </h2>
        </div>

        <span className="rounded-full bg-ground-sunken px-3 py-1 text-[11px] font-semibold text-muted">
          {items.length} checks
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.label}
            className={[
              'rounded-panel p-4',
              item.status === 'danger'
                ? 'bg-red-50'
                : item.status === 'warning'
                  ? 'bg-yellow-50'
                  : 'bg-green-50',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold text-ink">
                {item.label}
              </p>

              <span
                className={[
                  'h-2.5 w-2.5 rounded-full',
                  item.status === 'danger'
                    ? 'bg-red-500'
                    : item.status === 'warning'
                      ? 'bg-yellow-500'
                      : 'bg-green-500',
                ].join(' ')}
              />
            </div>

            <p className="mt-2 text-[12px] font-semibold text-[#666]">
              {item.detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AdminUserDetail({ userId }: { userId: string }) {
  const [data, setData] = useState<UserDetailPayload | null>(null)
  const [loading, setLoading] = useState(false)

  const loadDetail = useCallback(async () => {
    try {
      setLoading(true)

      const res = await fetch(`/api/admin/users/${userId}`, {
        cache: 'no-store',
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || 'Cannot load user detail')
      }

      setData(json)
    } catch (error) {
      console.error(error)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
  const run = () => {
    void loadDetail()
  }

  window.setTimeout(run, 0)
}, [loadDetail])

  const profile = data?.profile
  const storagePercent =
    profile && profile.storageLimitBytes > 0
      ? Math.min(
          100,
          Math.round(
            (profile.storageUsedBytes / profile.storageLimitBytes) * 100
          )
        )
      : 0
  const storageRisk = profile ? getStorageRisk(profile) : null
  const activityLevel = profile ? getUserActivityLevel(profile) : 'inactive'
    const userHealth =
    profile && data
      ? getUserHealth({
          profile,
          jobs: data.jobs,
          storageRisk,
          cameraImports: data.camera.recentImports,
        })
      : null

    const diagnostics =
    profile && data
      ? getUserDiagnostics({
          profile,
          jobs: data.jobs,
          storageRisk,
          cameraImports: data.camera.recentImports,
        })
      : []

  return (
    <main className="min-h-screen bg-ground-sunken px-4 py-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted">
              Ciiya Admin
            </p>

            <h1 className="mt-2 text-3xl font-semibold text-ink">
              User Detail
            </h1>

            <p className="mt-2 text-sm font-medium text-muted">
              Monitor user activity, uploads, albums, storage and processing.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadDetail}
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
          </div>
        </div>

        {!data || !profile ? (
          <div className="rounded-panel bg-white p-6 text-center text-sm text-red-500 shadow-sm ring-1 ring-line">
            Cannot load user detail.
          </div>
        ) : (
          <>
            <div className="rounded-hero border border-line bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-[30px] font-semibold tracking-[-0.05em] text-ink">
                    {profile.name}
                  </h2>

                  <p className="mt-1 text-sm font-semibold text-muted">
                    {profile.email || '-'}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span
                      className={[
                        'rounded-full px-3 py-1 text-xs font-semibold uppercase',
                        profile.status === 'active'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-ground-sunken text-muted',
                      ].join(' ')}
                    >
                      {profile.status}
                    </span>

                    <span className="rounded-full bg-gold-soft px-3 py-1 text-xs font-semibold uppercase text-gold-deep">
                      {profile.plan || 'free'}
                    </span>

                    <span className="rounded-full bg-ground-sunken px-3 py-1 text-xs font-semibold uppercase text-muted">
                      {profile.subscriptionStatus}
                    </span>
                  </div>
                </div>

                <div className="text-sm font-semibold text-muted md:text-right">
                  <p>Created: {formatDate(profile.createdAt)}</p>
                  <p>Last login: {formatDate(profile.lastLoginAt)}</p>
                  <p>Last active: {formatDate(profile.lastActiveAt)}</p>
                </div>
              </div>
            </div>

                        {userHealth ? (
              <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Health
                    </p>

                    <h2 className="mt-1 text-[26px] font-semibold tracking-[-0.05em] text-ink">
                      User Health
                    </h2>

                    <p className="mt-2 text-[13px] font-semibold text-muted">
                      Overall status based on activity, storage, queue and camera imports.
                    </p>
                  </div>

                  <div className="text-left md:text-right">
                    <p
                      className={[
                        'text-[34px] font-semibold tracking-[-0.06em]',
                        userHealth.score >= 90
                          ? 'text-green-600'
                          : userHealth.score >= 70
                            ? 'text-ink'
                            : userHealth.score >= 50
                              ? 'text-yellow-600'
                              : 'text-red-600',
                      ].join(' ')}
                    >
                      {userHealth.score}%
                    </p>

                    <p className="text-[12px] font-semibold uppercase text-muted">
                      {userHealth.label}
                    </p>
                  </div>
                </div>

                <div className="mt-5 h-3 overflow-hidden rounded-full bg-ground">
                  <div
                    className={[
                      'h-full rounded-full transition-all duration-300',
                      userHealth.score >= 90
                        ? 'bg-green-500'
                        : userHealth.score >= 70
                          ? 'bg-green-400'
                          : userHealth.score >= 50
                            ? 'bg-yellow-500'
                            : 'bg-red-500',
                    ].join(' ')}
                    style={{
                      width: `${userHealth.score}%`,
                    }}
                  />
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-panel bg-ground p-4">
                    <p className="text-[11px] font-semibold uppercase text-muted">
                      Account
                    </p>
                    <p className="mt-1 text-[14px] font-semibold text-ink">
                      {profile.status}
                    </p>
                  </div>

                  <div className="rounded-panel bg-ground p-4">
                    <p className="text-[11px] font-semibold uppercase text-muted">
                      Storage
                    </p>
                    <p className="mt-1 text-[14px] font-semibold text-ink">
                      {storageRisk?.label || 'Safe'}
                    </p>
                  </div>

                  <div className="rounded-panel bg-ground p-4">
                    <p className="text-[11px] font-semibold uppercase text-muted">
                      Queue
                    </p>
                    <p className="mt-1 text-[14px] font-semibold text-ink">
                      {data.jobs.failed > 0
                        ? `${data.jobs.failed} failed`
                        : 'Clear'}
                    </p>
                  </div>

                  <div className="rounded-panel bg-ground p-4">
                    <p className="text-[11px] font-semibold uppercase text-muted">
                      Camera
                    </p>
                    <p className="mt-1 text-[14px] font-semibold text-ink">
                      {data.camera.recentImports.some(
                        (item) => item.status === 'failed'
                      )
                        ? 'Check'
                        : 'Healthy'}
                    </p>
                  </div>
                </div>

                {userHealth.issues.length > 0 ? (
                  <div className="mt-5 rounded-panel bg-yellow-50 p-4">
                    <p className="text-[12px] font-semibold uppercase text-yellow-700">
                      Issues
                    </p>

                    <div className="mt-2 space-y-1">
                      {userHealth.issues.map((issue) => (
                        <p
                          key={issue}
                          className="text-[12px] font-semibold text-yellow-700"
                        >
                          • {issue}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-panel bg-green-50 p-4">
                    <p className="text-[12px] font-semibold uppercase text-green-700">
                      No active issues
                    </p>
                  </div>
                )}
              </div>
            ) : null}

             <UserTimeline items={data.timeline || []} />
             <UserDiagnosticsCard items={diagnostics} />

            <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
  <div className="grid gap-3 md:grid-cols-3">
    <div className="rounded-panel bg-ground p-4">
      <p className="text-[11px] font-semibold uppercase text-muted">
        Activity
      </p>
      <p className="mt-1 text-[22px] font-semibold text-ink">
        {activityLevel}
      </p>
    </div>

    <div className="rounded-panel bg-ground p-4">
      <p className="text-[11px] font-semibold uppercase text-muted">
        Storage Risk
      </p>
      <p
        className={[
          'mt-1 text-[22px] font-semibold',
          storageRisk?.level === 'danger'
            ? 'text-red-600'
            : storageRisk?.level === 'warning'
              ? 'text-yellow-600'
              : 'text-ink',
        ].join(' ')}
      >
        {storageRisk?.label || 'Safe'}
      </p>
    </div>

    <div className="rounded-panel bg-ground p-4">
      <p className="text-[11px] font-semibold uppercase text-muted">
        Last Upload
      </p>
      <p className="mt-1 text-[14px] font-semibold text-ink">
        {formatDate(profile.lastUploadAt)}
      </p>
    </div>
  </div>
</div>

            <div className="grid gap-4 md:grid-cols-4">
              <StatCard label="Albums" value={profile.albumCount} />
              <StatCard label="Photos" value={profile.photoCount} />
              <StatCard
                label="Storage"
                value={formatBytes(profile.storageUsedBytes)}
              />
              <StatCard
                label="Jobs Failed"
                value={data.jobs.failed}
              />
            </div>

            <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Storage
                  </p>

                  <h2 className="mt-1 text-[22px] font-semibold text-ink">
                    Usage
                  </h2>
                </div>

                <span className="rounded-full bg-ground-sunken px-3 py-1 text-xs font-semibold text-muted">
                  {storagePercent}%
                </span>
              </div>

              <div className="mt-4 h-3 overflow-hidden rounded-full bg-ground">
                <div
                  className="h-full rounded-full bg-gold"
                  style={{ width: `${storagePercent}%` }}
                />
              </div>

              <p className="mt-3 text-sm font-semibold text-muted">
                {formatBytes(profile.storageUsedBytes)} /{' '}
                {profile.storageLimitBytes > 0
                  ? formatBytes(profile.storageLimitBytes)
                  : 'No limit set'}
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
                <h2 className="text-lg font-bold text-ink">
                  Albums
                </h2>

                <div className="mt-4 space-y-3">
                  {data.albums.length > 0 ? (
                    data.albums.map((album) => (
                      <div
                        key={album.id}
                        className="rounded-panel bg-ground p-4"
                      >
                        <p className="font-semibold text-ink">
                          {album.title}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-muted">
                          {album.photoCount} photos · Updated{' '}
                          {formatDate(album.updatedAt)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-panel bg-ground p-4 text-sm text-muted">
                      No albums.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
                <h2 className="text-lg font-bold text-ink">
                  Recent Uploads
                </h2>

                <div className="mt-4 space-y-3">
                  {data.recentUploads.length > 0 ? (
                    data.recentUploads.map((photo) => (
                      <div
                        key={photo.id}
                        className="flex items-center gap-3 rounded-panel bg-ground p-3"
                      >
                        {photo.previewUrl ? (
                          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-card">
                            <Image
                              src={photo.previewUrl}
                              alt={photo.filename}
                              fill
                              sizes="48px"
                              unoptimized
                              className="object-cover"
                            />
                          </div>
                        ) : (
                          <div className="h-12 w-12 rounded-card bg-ground-sunken" />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">
                            {photo.filename}
                          </p>
                          <p className="text-xs font-semibold text-muted">
                            {photo.status} · {formatBytes(photo.fileSizeBytes)}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-panel bg-ground p-4 text-sm text-muted">
                      No uploads.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
                <h2 className="text-lg font-bold text-ink">
                  Processing
                </h2>

                <div className="mt-4 grid grid-cols-4 gap-3">
                  <StatCard label="Pending" value={data.jobs.pending} />
                  <StatCard label="Running" value={data.jobs.processing} />
                  <StatCard label="Failed" value={data.jobs.failed} />
                  <StatCard label="Done" value={data.jobs.done} />
                </div>
              </div>

              <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
                <h2 className="text-lg font-bold text-ink">
                  Camera Recent Imports
                </h2>

                <div className="mt-4 space-y-3">
                  {data.camera.recentImports.length > 0 ? (
                    data.camera.recentImports.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-panel bg-ground p-4"
                      >
                        <div className="flex justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-ink">
                            {item.filename || 'Camera file'}
                          </p>

                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase text-ink-soft">
                            {item.status || 'unknown'}
                          </span>
                        </div>

                        <p className="mt-1 text-xs font-semibold text-muted">
                          {Number(item.progress || 0)}% ·{' '}
                          {formatDate(item.created_at)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-panel bg-ground p-4 text-sm text-muted">
                      No camera imports.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <p className="text-center text-xs font-semibold text-muted">
              Last checked: {formatDate(data.checkedAt)}
            </p>
          </>
        )}
      </div>
    </main>
  )
}