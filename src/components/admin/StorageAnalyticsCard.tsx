'use client'

function formatBytes(bytes?: number | null) {
  const value = Number(bytes || 0)

  if (value < 1024) return `${value} B`

  const kb = value / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`

  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`

  const gb = mb / 1024

  return `${gb.toFixed(2)} GB`
}

type StorageAnalytics = {
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

export default function StorageAnalyticsCard({
  data,
}: {
  data: StorageAnalytics
}) {
  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Storage
          </p>

          <h2 className="mt-1 text-[26px] font-semibold text-ink">
            Storage Analytics
          </h2>
        </div>

        <span className="rounded-full bg-ground-sunken px-3 py-1 text-[11px] font-semibold text-muted">
          {data.totalUsers} users
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Total Used
          </p>

          <p className="mt-1 text-[24px] font-semibold text-ink">
            {formatBytes(data.totalStorageUsed)}
          </p>
        </div>

        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Capacity
          </p>

          <p className="mt-1 text-[24px] font-semibold text-ink">
            {formatBytes(data.totalStorageLimit)}
          </p>
        </div>

        <div className="rounded-panel bg-ground p-4">
          <p className="text-[11px] font-semibold uppercase text-muted">
            Average/User
          </p>

          <p className="mt-1 text-[24px] font-semibold text-ink">
            {formatBytes(data.averageStorage)}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-[13px] font-semibold text-ink">
          Top Storage Users
        </p>

        <div className="mt-3 space-y-3">
          {data.topUsers.map((user) => (
            <div
              key={user.userId}
              className="rounded-card bg-ground p-4"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {user.userId}
                  </p>

                  <p className="text-[11px] font-semibold text-muted">
                    {user.plan}
                  </p>
                </div>

                <span className="text-[12px] font-semibold text-ink">
                  {user.percent}%
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                <div
                  className={`h-full rounded-full ${
                    user.percent >= 90
                      ? 'bg-red-500'
                      : user.percent >= 70
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                  }`}
                  style={{
                    width: `${Math.min(user.percent, 100)}%`,
                  }}
                />
              </div>

              <p className="mt-2 text-[11px] font-semibold text-muted">
                {formatBytes(user.usedBytes)} / {formatBytes(user.limitBytes)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}