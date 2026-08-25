'use client'

import { useEffect, useMemo, useState } from 'react'

type Worker = {
  worker_id: string
  worker_name?: string | null
  worker_type?: string | null
  status?: string | null
  last_seen_at?: string | null
  last_seen?: string | null
}

type Metrics = {
  success: boolean
  checkedAt: string
  workers: Worker[]
  queues: {
    photo: {
      pending: number
      processing: number
      failed: number
    }
    face: {
      pending: number
      processing: number
      failed: number
    }
  }
  recentErrors: {
    id: string
    worker_type?: string | null
    level?: string | null
    message?: string | null
    created_at?: string | null
  }[]
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function isOnline(worker: Worker) {
  const lastSeen = worker.last_seen_at || worker.last_seen
  if (!lastSeen) return false

  return Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000
}

export default function AdminWorkersLivePage() {
  const [data, setData] = useState<Metrics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const res = await fetch('/api/admin/worker-metrics', {
        cache: 'no-store',
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || 'Cannot load worker metrics')
      }

      setData(json)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot load metrics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
  const bootstrap = async () => {
    await Promise.resolve()
    await load()
  }

  void bootstrap()

  const timer = window.setInterval(() => {
    void load()
  }, 5000)

  return () => {
    window.clearInterval(timer)
  }
}, [])

  const onlineWorkers = useMemo(() => {
    return data?.workers.filter(isOnline).length || 0
  }, [data])

  if (loading) {
    return (
      <main className="p-5 text-sm font-semibold text-muted">
        Loading worker metrics...
      </main>
    )
  }

  if (error) {
    return (
      <main className="p-5 text-sm font-semibold text-red-600">
        {error}
      </main>
    )
  }

  if (!data) return null

  return (
    <main className="space-y-5 p-5">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-[24px] bg-white p-5 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase text-muted">
            Online Workers
          </p>
          <p className="mt-2 text-3xl font-black">
            {onlineWorkers}/{data.workers.length}
          </p>
        </div>

        <div className="rounded-[24px] bg-white p-5 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase text-muted">
            Photo Queue
          </p>
          <p className="mt-2 text-3xl font-black">
            {data.queues.photo.pending + data.queues.photo.processing}
          </p>
        </div>

        <div className="rounded-[24px] bg-white p-5 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase text-muted">
            Face Queue
          </p>
          <p className="mt-2 text-3xl font-black">
            {data.queues.face.pending + data.queues.face.processing}
          </p>
        </div>

        <div className="rounded-[24px] bg-white p-5 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase text-muted">
            Failed Jobs
          </p>
          <p className="mt-2 text-3xl font-black text-red-600">
            {data.queues.photo.failed + data.queues.face.failed}
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-[28px] bg-white p-5 ring-1 ring-black/5">
          <h2 className="text-lg font-black">Workers</h2>

          <div className="mt-4 space-y-3">
            {data.workers.length === 0 ? (
              <div className="rounded-2xl bg-ground-sunken p-4 text-sm text-muted">
                No workers found.
              </div>
            ) : (
              data.workers.map((worker) => {
                const online = isOnline(worker)

                return (
                  <div
                    key={worker.worker_id}
                    className="rounded-2xl bg-ground-sunken p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">
                          {worker.worker_name || worker.worker_id}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {worker.worker_type || '-'} · last seen{' '}
                          {formatDate(worker.last_seen_at || worker.last_seen)}
                        </p>
                      </div>

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
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
        </section>

        <section className="rounded-[28px] bg-white p-5 ring-1 ring-black/5">
          <h2 className="text-lg font-black">Queue Status</h2>

          <div className="mt-4 grid gap-3">
            <QueueCard title="Photo Jobs" data={data.queues.photo} />
            <QueueCard title="Face Jobs" data={data.queues.face} />
          </div>
        </section>
      </div>

      <section className="rounded-[28px] bg-white p-5 ring-1 ring-black/5">
        <h2 className="text-lg font-black">Recent Errors</h2>

        <div className="mt-4 space-y-3">
          {data.recentErrors.length === 0 ? (
            <div className="rounded-2xl bg-green-50 p-4 text-sm font-semibold text-green-700">
              No recent worker errors.
            </div>
          ) : (
            data.recentErrors.map((item) => (
              <div key={item.id} className="rounded-2xl bg-red-50 p-4">
                <p className="text-xs font-black uppercase text-red-500">
                  {item.worker_type || 'worker'} · {formatDate(item.created_at)}
                </p>
                <p className="mt-2 text-sm font-semibold text-red-700">
                  {item.message || 'Unknown error'}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <p className="text-center text-xs text-muted">
        Last checked: {formatDate(data.checkedAt)}
      </p>
    </main>
  )
}

function QueueCard({
  title,
  data,
}: {
  title: string
  data: { pending: number; processing: number; failed: number }
}) {
  return (
    <div className="rounded-2xl bg-ground-sunken p-4">
      <p className="text-sm font-black">{title}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white p-3">
          <p className="text-xs text-muted">Pending</p>
          <p className="font-black">{data.pending}</p>
        </div>

        <div className="rounded-xl bg-white p-3">
          <p className="text-xs text-muted">Processing</p>
          <p className="font-black">{data.processing}</p>
        </div>

        <div className="rounded-xl bg-white p-3">
          <p className="text-xs text-muted">Failed</p>
          <p className="font-black text-red-600">{data.failed}</p>
        </div>
      </div>
    </div>
  )
}