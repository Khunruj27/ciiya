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
    <div className="rounded-[30px] border border-black/5 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-black uppercase tracking-[0.14em] text-[#8E8E93]">
            Storage
          </p>

          <h2 className="mt-1 text-[26px] font-black text-[#1C0617]">
            Storage Analytics
          </h2>
        </div>

        <span className="rounded-full bg-[#F6F7FA] px-3 py-1 text-[11px] font-black text-[#8E8E93]">
          {data.totalUsers} users
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-[22px] bg-[#FAF7F4] p-4">
          <p className="text-[11px] font-black uppercase text-[#8E8E93]">
            Total Used
          </p>

          <p className="mt-1 text-[24px] font-black text-[#1C0617]">
            {formatBytes(data.totalStorageUsed)}
          </p>
        </div>

        <div className="rounded-[22px] bg-[#FAF7F4] p-4">
          <p className="text-[11px] font-black uppercase text-[#8E8E93]">
            Capacity
          </p>

          <p className="mt-1 text-[24px] font-black text-[#1C0617]">
            {formatBytes(data.totalStorageLimit)}
          </p>
        </div>

        <div className="rounded-[22px] bg-[#FAF7F4] p-4">
          <p className="text-[11px] font-black uppercase text-[#8E8E93]">
            Average/User
          </p>

          <p className="mt-1 text-[24px] font-black text-[#1C0617]">
            {formatBytes(data.averageStorage)}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-[13px] font-black text-[#1C0617]">
          Top Storage Users
        </p>

        <div className="mt-3 space-y-3">
          {data.topUsers.map((user) => (
            <div
              key={user.userId}
              className="rounded-[18px] bg-[#FAF7F4] p-4"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-black text-[#1C0617]">
                    {user.userId}
                  </p>

                  <p className="text-[11px] font-semibold text-[#8E8E93]">
                    {user.plan}
                  </p>
                </div>

                <span className="text-[12px] font-black text-[#1C0617]">
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
                        : 'bg-[#D0F578]'
                  }`}
                  style={{
                    width: `${Math.min(user.percent, 100)}%`,
                  }}
                />
              </div>

              <p className="mt-2 text-[11px] font-semibold text-[#8E8E93]">
                {formatBytes(user.usedBytes)} / {formatBytes(user.limitBytes)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}