'use client'

type AuditPayload = {
  upload: {
    photos: {
      failed: number
      stuck: number
    }
    jobs: {
      stuck: number
      byStatus: Record<string, number>
    }
  }

  face: {
    stuck: number
    byStatus: Record<string, number>
  }

  workers: {
    offline: number
  }

  storage: {
    warningUsers: number
    dangerUsers: number
  }

  dataIntegrity: {
    duplicateHashCount: number
    jobsWithoutPhoto: number
    faceJobsWithoutPhoto: number
  }

  logs: {
    recentErrors: unknown[]
  }
}

export default function AlertCenter({
  data,
}: {
  data: AuditPayload
}) {
  const alerts: {
    level: 'danger' | 'warning'
    title: string
    detail: string
  }[] = []

  if (data.upload.photos.failed > 0) {
    alerts.push({
      level: 'danger',
      title: 'Photo Processing Failed',
      detail: `${data.upload.photos.failed} failed photo(s)`,
    })
  }

  if (data.upload.jobs.stuck > 0) {
    alerts.push({
      level: 'warning',
      title: 'Upload Queue Stuck',
      detail: `${data.upload.jobs.stuck} stuck job(s)`,
    })
  }

  if ((data.face.byStatus.failed || 0) > 0) {
    alerts.push({
      level: 'danger',
      title: 'Face AI Failed',
      detail: `${data.face.byStatus.failed} failed face job(s)`,
    })
  }

  if (data.face.stuck > 0) {
    alerts.push({
      level: 'warning',
      title: 'Face Queue Stuck',
      detail: `${data.face.stuck} stuck face job(s)`,
    })
  }

  if (data.workers.offline > 0) {
    alerts.push({
      level: 'danger',
      title: 'Worker Offline',
      detail: `${data.workers.offline} offline worker(s)`,
    })
  }

  if (data.storage.dangerUsers > 0) {
    alerts.push({
      level: 'danger',
      title: 'Storage Almost Full',
      detail: `${data.storage.dangerUsers} user(s) above 90%`,
    })
  }

  if (
    data.storage.warningUsers > 0 &&
    data.storage.dangerUsers === 0
  ) {
    alerts.push({
      level: 'warning',
      title: 'Storage Warning',
      detail: `${data.storage.warningUsers} user(s) above 70%`,
    })
  }

  if (data.dataIntegrity.duplicateHashCount > 0) {
    alerts.push({
      level: 'warning',
      title: 'Duplicate Photos',
      detail: `${data.dataIntegrity.duplicateHashCount} duplicate hash group(s)`,
    })
  }

  if (
    data.dataIntegrity.jobsWithoutPhoto > 0 ||
    data.dataIntegrity.faceJobsWithoutPhoto > 0
  ) {
    alerts.push({
      level: 'danger',
      title: 'Orphan Jobs',
      detail:
        `${data.dataIntegrity.jobsWithoutPhoto + data.dataIntegrity.faceJobsWithoutPhoto} orphan job(s)`,
    })
  }

  if (data.logs.recentErrors.length > 0) {
    alerts.push({
      level: 'warning',
      title: 'Recent Worker Errors',
      detail: `${data.logs.recentErrors.length} recent error log(s)`,
    })
  }

  return (
    <div className="rounded-hero border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
            Alerts
          </p>

          <h2 className="mt-1 text-[26px] font-semibold text-ink">
            Active Alerts
          </h2>
        </div>

        <span className="rounded-full bg-ground-sunken px-3 py-1 text-[11px] font-semibold text-muted">
          {alerts.length} alert(s)
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {alerts.length > 0 ? (
          alerts.map((alert, index) => (
            <div
              key={`${alert.title}-${index}`}
              className={[
                'rounded-panel border p-4',
                alert.level === 'danger'
                  ? 'border-red-200 bg-red-50'
                  : 'border-yellow-200 bg-yellow-50',
              ].join(' ')}
            >
              <p
                className={[
                  'text-[13px] font-semibold',
                  alert.level === 'danger'
                    ? 'text-red-700'
                    : 'text-yellow-700',
                ].join(' ')}
              >
                {alert.title}
              </p>

              <p
                className={[
                  'mt-1 text-[12px] font-semibold',
                  alert.level === 'danger'
                    ? 'text-red-600'
                    : 'text-yellow-700',
                ].join(' ')}
              >
                {alert.detail}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-panel bg-green-50 p-5">
            <p className="text-[13px] font-semibold text-green-700">
              ✅ No active alerts
            </p>

            <p className="mt-1 text-[12px] font-semibold text-green-600">
              Production system is healthy.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}