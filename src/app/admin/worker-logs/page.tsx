import { createServerSupabaseClient } from '@/lib/supabase-server'
import RetryFailedWorkerButton from '@/components/retry-failed-worker-button'
import RunWorkerButton from '@/components/run-worker-button'

export const dynamic = 'force-dynamic'

export default async function WorkerLogsPage() {
  const supabase = await createServerSupabaseClient()

  const [{ data: logs, error }, pending, processing, done, failed] =
    await Promise.all([
      supabase
        .from('worker_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),

      supabase
        .from('photo_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),

      supabase
        .from('photo_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'processing'),

      supabase
        .from('photo_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'done'),

      supabase
        .from('photo_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
    ])

  if (error) {
    return (
      <main className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load logs: {error.message}
        </div>
      </main>
    )
  }

  const stats = [
    { label: 'Pending', value: pending.count ?? 0 },
    { label: 'Processing', value: processing.count ?? 0 },
    { label: 'Done', value: done.count ?? 0 },
    { label: 'Failed', value: failed.count ?? 0 },
  ]

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            Worker Logs
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            สรุปสถานะ Worker Jobs และ Error Logs ล่าสุด 100 รายการ
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
        <RetryFailedWorkerButton />
       <RunWorkerButton />
       </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-sm text-slate-500">{item.label}</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">
                {item.value}
              </p>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">
                    Time
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">
                    Level
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">
                    Message
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">
                    Photo
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">
                    Meta
                  </th>
                </tr>
              </thead>

              <tbody>
                {(logs || []).map((log) => (
                  <tr
                    key={log.id}
                    className="border-t border-slate-100 align-top"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {new Date(log.created_at).toLocaleString()}
                    </td>

                    <td className="px-4 py-3">
                      <span className="rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
                        {log.level}
                      </span>
                    </td>

                    <td className="max-w-md px-4 py-3 text-slate-800">
                      {log.message}
                    </td>

                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {log.photo_id || '-'}
                    </td>

                    <td className="max-w-lg px-4 py-3">
                      <pre className="overflow-auto rounded-lg bg-slate-100 p-2 text-xs text-slate-700">
                        {JSON.stringify(log.meta || {}, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}

                {(!logs || logs.length === 0) && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-slate-500"
                    >
                      No worker logs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  )
}