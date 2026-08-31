'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type AdminUserRow = {
  id: string
  email: string | null
  name: string
  status: 'active' | 'no active' | string
  lastActiveAt: string | null
  lastSignInAt: string | null
  createdAt: string | null
  albumCount: number
  photoCount: number
  storageUsedBytes: number
  storageLimitBytes: number
  plan: string
  subscriptionStatus: string
  lastUploadAt: string | null
}

type UsersSummary = {
  totalUsers: number
  activeUsers: number
  inactiveUsers: number
  totalPhotos: number
  totalAlbums: number
  totalStorageUsed: number
    todayUploads?: number
  todayActiveUsers?: number
  newUsersToday?: number
  topStorageUsers?: {
    id: string
    name: string
    email: string | null
    storageUsedBytes: number
  }[]
  topPhotoUsers?: {
    id: string
    name: string
    email: string | null
    photoCount: number
  }[]
  recentNewUsers?: {
    id: string
    name: string
    email: string | null
    createdAt: string | null
  }[]
  uploadHours?: {
    hour: number
    count: number
  }[]
}

type UsersPayload = {
  success: boolean
  summary: UsersSummary
  users: AdminUserRow[]
  checkedAt: string
}

type SortKey =
  | 'lastActive'
  | 'created'
  | 'photos'
  | 'albums'
  | 'storage'
  | 'plan'

type PlanFilter = 'all' | 'free' | 'starter' | 'pro' | 'business'

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

function getActiveLevel(user: AdminUserRow) {
  if (!user.lastActiveAt) return 'cold'

  const ageMs = Date.now() - new Date(user.lastActiveAt).getTime()
  const days = ageMs / (24 * 60 * 60 * 1000)

  if (days <= 1) return 'hot'
  if (days <= 7) return 'warm'
  if (days <= 30) return 'cool'

  return 'cold'
}

function getActiveLevelLabel(level: string) {
  if (level === 'hot') return 'Active today'
  if (level === 'warm') return 'Active 7d'
  if (level === 'cool') return 'Active 30d'
  return 'Inactive'
}

function getUsageLevel(user: AdminUserRow) {
  if (user.photoCount >= 10000 || user.storageUsedBytes >= 50 * 1024 ** 3) {
    return 'heavy'
  }

  if (user.photoCount >= 1000 || user.storageUsedBytes >= 5 * 1024 ** 3) {
    return 'medium'
  }

  if (user.photoCount > 0 || user.albumCount > 0) {
    return 'light'
  }

  return 'none'
}

function SummaryCard({
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
      <p className="mt-2 text-[28px] font-semibold tracking-[-0.05em] text-ink">
        {value}
      </p>
    </div>
  )
}

function GlobalAnalytics({
  summary,
}: {
  summary: UsersSummary
}) {
  const maxUploadHour = Math.max(
    1,
    ...(summary.uploadHours || []).map((item) => item.count)
  )

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line lg:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Global
            </p>

            <h2 className="mt-1 text-[22px] font-semibold text-ink">
              Today Overview
            </h2>
          </div>

          <span className="rounded-full bg-green-50 px-3 py-1 text-[11px] font-semibold text-green-700">
            Live
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-panel bg-ground p-4">
            <p className="text-[11px] font-semibold uppercase text-muted">
              Uploads Today
            </p>
            <p className="mt-1 text-[26px] font-semibold text-ink">
              {summary.todayUploads || 0}
            </p>
          </div>

          <div className="rounded-panel bg-ground p-4">
            <p className="text-[11px] font-semibold uppercase text-muted">
              Active Today
            </p>
            <p className="mt-1 text-[26px] font-semibold text-ink">
              {summary.todayActiveUsers || 0}
            </p>
          </div>

          <div className="rounded-panel bg-ground p-4">
            <p className="text-[11px] font-semibold uppercase text-muted">
              New Users
            </p>
            <p className="mt-1 text-[26px] font-semibold text-ink">
              {summary.newUsersToday || 0}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Uploads by hour
          </p>

          <div className="mt-3 flex h-28 items-end gap-1 rounded-panel bg-ground p-3">
            {(summary.uploadHours || []).map((item) => (
              <div
                key={item.hour}
                className="flex flex-1 flex-col items-center justify-end gap-1"
              >
                <div
                  className="w-full rounded-t-md bg-gold"
                  style={{
                    height: `${Math.max(
                      4,
                      Math.round((item.count / maxUploadHour) * 80)
                    )}%`,
                  }}
                  title={`${item.hour}:00 ${item.count} uploads`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Growth
        </p>

        <h2 className="mt-1 text-[22px] font-semibold text-ink">
          New Users
        </h2>

        <div className="mt-4 space-y-3">
          {(summary.recentNewUsers || []).length > 0 ? (
            (summary.recentNewUsers || []).map((user) => (
              <Link
                key={user.id}
                href={`/admin/users/${user.id}`}
                className="block rounded-card bg-ground p-3 hover:bg-ground-sunken"
              >
                <p className="truncate text-[13px] font-semibold text-ink">
                  {user.name}
                </p>
                <p className="mt-1 truncate text-[11px] font-semibold text-muted">
                  {user.email || '-'}
                </p>
                <p className="mt-1 text-[11px] text-muted">
                  {formatDate(user.createdAt)}
                </p>
              </Link>
            ))
          ) : (
            <p className="rounded-card bg-ground p-4 text-sm text-muted">
              No new users.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
        <h2 className="text-lg font-bold text-ink">
          Top Photo Users
        </h2>

        <div className="mt-4 space-y-3">
          {(summary.topPhotoUsers || []).map((user) => (
            <Link
              key={user.id}
              href={`/admin/users/${user.id}`}
              className="flex items-center justify-between rounded-card bg-ground p-3 hover:bg-ground-sunken"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {user.name}
                </p>
                <p className="truncate text-xs text-muted">
                  {user.email || '-'}
                </p>
              </div>

              <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-soft">
                {user.photoCount}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line lg:col-span-2">
        <h2 className="text-lg font-bold text-ink">
          Top Storage Users
        </h2>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(summary.topStorageUsers || []).map((user) => (
            <Link
              key={user.id}
              href={`/admin/users/${user.id}`}
              className="rounded-card bg-ground p-3 hover:bg-ground-sunken"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {user.email || '-'}
                  </p>
                </div>

                <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-soft">
                  {formatBytes(user.storageUsedBytes)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function AdminUsersDashboard() {
  const [payload, setPayload] = useState<UsersPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'no active'>(
    'all'
  )
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('lastActive')

  async function loadUsers() {
    try {
      setLoading(true)

      const res = await fetch('/api/admin/users', {
        cache: 'no-store',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || 'Cannot load users')
      }

      setPayload(data)
    } catch (error) {
      console.error(error)
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
  const run = () => {
    void loadUsers()
  }

  window.setTimeout(run, 0)
}, [])

    const filteredUsers = useMemo(() => {
    const users = payload?.users || []
    const keyword = query.trim().toLowerCase()

    return users
      .filter((user) => {
        const matchKeyword =
          !keyword ||
          String(user.email || '').toLowerCase().includes(keyword) ||
          String(user.name || '').toLowerCase().includes(keyword) ||
          String(user.plan || '').toLowerCase().includes(keyword)

        const matchStatus =
          statusFilter === 'all' || user.status === statusFilter

        const normalizedPlan = String(user.plan || 'free').toLowerCase()
        const matchPlan =
          planFilter === 'all' || normalizedPlan.includes(planFilter)

        return matchKeyword && matchStatus && matchPlan
      })
      .sort((a, b) => {
        if (sortKey === 'photos') return b.photoCount - a.photoCount
        if (sortKey === 'albums') return b.albumCount - a.albumCount
        if (sortKey === 'storage') {
          return Number(b.storageUsedBytes || 0) - Number(a.storageUsedBytes || 0)
        }
        if (sortKey === 'created') {
          return (
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
          )
        }
        if (sortKey === 'plan') {
          return String(a.plan || '').localeCompare(String(b.plan || ''))
        }

        return (
          new Date(b.lastActiveAt || 0).getTime() -
          new Date(a.lastActiveAt || 0).getTime()
        )
      })
  }, [payload, query, statusFilter, planFilter, sortKey])

  return (
    <main className="min-h-screen bg-ground-sunken px-4 py-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted">
              Ciiya Admin
            </p>

            <h1 className="mt-2 text-3xl font-semibold text-ink">
              Users Dashboard
            </h1>

            <p className="mt-2 text-sm font-medium text-muted">
              Monitor app users, activity, albums, photos and storage usage.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/admin/announcements"
              className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm"
            >
              Announcements
            </Link>

            <button
              type="button"
              onClick={loadUsers}
              disabled={loading}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm ring-1 ring-line disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>

            <Link
              href="/admin/queue"
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm ring-1 ring-line"
            >
              Queue
            </Link>
          </div>
        </div>

        {!payload ? (
          <div className="rounded-panel bg-white p-6 text-center text-sm text-red-500 shadow-sm ring-1 ring-line">
            Cannot load users dashboard.
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-5">
              <SummaryCard
                label="Total Users"
                value={payload.summary.totalUsers}
              />
              <SummaryCard
                label="Active"
                value={payload.summary.activeUsers}
              />
              <SummaryCard
                label="No Active"
                value={payload.summary.inactiveUsers}
              />
              <SummaryCard
                label="Photos"
                value={payload.summary.totalPhotos}
              />
              <SummaryCard
                label="Storage"
                value={formatBytes(payload.summary.totalStorageUsed)}
              />
            </div>
            
            <GlobalAnalytics summary={payload.summary} />

                            <div className="flex gap-2 overflow-x-auto">
                  {(['all', 'free', 'starter', 'pro', 'business'] as const).map(
                    (plan) => (
                      <button
                        key={plan}
                        type="button"
                        onClick={() => setPlanFilter(plan)}
                        className={[
                          'rounded-full px-4 py-2 text-xs font-semibold uppercase',
                          planFilter === plan
                            ? 'bg-gold text-ink'
                            : 'bg-ground-sunken text-ink-soft',
                        ].join(' ')}
                      >
                        {plan}
                      </button>
                    )
                  )}
                </div>

                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="h-10 rounded-full border border-line bg-ground-sunken px-4 text-xs font-semibold uppercase text-ink-soft outline-none"
                >
                  <option value="lastActive">Sort: Last Active</option>
                  <option value="created">Sort: Created</option>
                  <option value="photos">Sort: Photos</option>
                  <option value="albums">Sort: Albums</option>
                  <option value="storage">Sort: Storage</option>
                  <option value="plan">Sort: Plan</option>
                </select>

            <div className="rounded-panel bg-white p-5 shadow-sm ring-1 ring-line">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, email or plan..."
                  className="h-11 w-full rounded-panel border border-line bg-ground-sunken px-4 text-sm font-semibold outline-none md:max-w-md"
                />

                <div className="flex gap-2">
                  {(['all', 'active', 'no active'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter(status)}
                      className={[
                        'rounded-full px-4 py-2 text-xs font-semibold uppercase',
                        statusFilter === status
                          ? 'bg-ink text-white'
                          : 'bg-ground-sunken text-ink-soft',
                      ].join(' ')}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              <p className="mt-3 text-xs font-semibold text-muted">
                Last checked: {formatDate(payload.checkedAt)}
              </p>
            </div>

            <div className="overflow-hidden rounded-panel bg-white shadow-sm ring-1 ring-line">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-ground text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Activity</th>
                      <th className="px-4 py-3">Usage</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Albums</th>
                      <th className="px-4 py-3">Photos</th>
                      <th className="px-4 py-3">Storage</th>
                      <th className="px-4 py-3">Last Active</th>
                      <th className="px-4 py-3">Created</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-black/5">
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map((user) => (
                       <tr key={user.id} className="align-top hover:bg-ground">
                          <td className="px-4 py-4">
                            <Link
  href={`/admin/users/${user.id}`}
  className="font-semibold text-ink hover:underline"
>
  {user.name}
</Link>
                            <p className="mt-1 text-xs text-muted">
                              {user.email || '-'}
                            </p>
                          </td>

                          <td className="px-4 py-4">
                            <span
                              className={[
                                'rounded-full px-3 py-1 text-xs font-semibold uppercase',
                                user.status === 'active'
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-ground-sunken text-muted',
                              ].join(' ')}
                            >
                              {user.status}
                            </span>
                          </td>

                          <td className="px-4 py-4 font-semibold text-ink-soft">
                            {user.plan || 'free'}
                          </td>

                          <td className="px-4 py-4 font-semibold text-ink">
                            {user.albumCount}
                          </td>

                          <td className="px-4 py-4 font-semibold text-ink">
                            {user.photoCount}
                          </td>

                          <td className="px-4 py-4 font-semibold text-ink-soft">
                            {formatBytes(user.storageUsedBytes)}
                          </td>

                          <td className="px-4 py-4 text-xs text-muted">
                            {formatDate(user.lastActiveAt)}
                          </td>

                          <td className="px-4 py-4 text-xs text-muted">
                            {formatDate(user.createdAt)}
                          </td>

                                                    <td className="px-4 py-4">
                            {(() => {
                              const level = getActiveLevel(user)

                              return (
                                <span
                                  className={[
                                    'rounded-full px-3 py-1 text-xs font-semibold uppercase',
                                    level === 'hot'
                                      ? 'bg-green-50 text-green-700'
                                      : level === 'warm'
                                        ? 'bg-blue-50 text-blue-700'
                                        : level === 'cool'
                                          ? 'bg-yellow-50 text-yellow-700'
                                          : 'bg-ground-sunken text-muted',
                                  ].join(' ')}
                                >
                                  {getActiveLevelLabel(level)}
                                </span>
                              )
                            })()}
                          </td>

                          <td className="px-4 py-4">
                            {(() => {
                              const level = getUsageLevel(user)

                              return (
                                <span className="rounded-full bg-ground-sunken px-3 py-1 text-xs font-semibold uppercase text-ink-soft">
                                  {level}
                                </span>
                              )
                            })()}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={10}
                          className="px-4 py-10 text-center text-sm text-muted"
                        >
                          No users found.
                        </td>
                        
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
