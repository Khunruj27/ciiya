import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export default async function AdminWorkersPage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) redirect('/login')

  const isAdmin =
    process.env.NODE_ENV === 'development' ||
    getAdminEmails().includes(user.email.toLowerCase())

  if (!isAdmin) redirect('/albums')

  return (
    <main className="min-h-screen bg-[#F8F9FC] px-4 py-6 text-ink">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-muted">
            Ciiya Admin
          </p>

          <h1 className="mt-2 text-3xl font-black tracking-[-0.05em]">
            Worker Monitoring
          </h1>

          <p className="mt-2 text-sm font-medium text-muted">
            Monitor photo worker, face worker, queue backlog, and recent errors.
          </p>
        </div>

        <WorkerMetricsClient />
      </div>
    </main>
  )
}

function WorkerMetricsClient() {
  return (
    <iframe
      src="/admin/workers/live"
      className="h-[calc(100dvh-160px)] w-full rounded-[28px] border border-black/5 bg-white"
    />
  )
}