import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AdminQueueDashboard from '@/components/admin-queue-dashboard'

export const dynamic = 'force-dynamic'

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export default async function AdminQueuePage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/login')
  }

  const adminEmails = getAdminEmails()
  const userEmail = user.email.toLowerCase()

  const isAdmin =
    process.env.NODE_ENV === 'development' ||
    adminEmails.includes(userEmail)

  if (!isAdmin) {
    redirect('/albums')
  }

  return (
    <main className="min-h-screen bg-[#F6F7FB] px-4 py-6">
      <div className="mx-auto max-w-7xl">
        <AdminQueueDashboard />
      </div>
    </main>
  )
}