import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AdminAnnouncementsDashboard from '@/components/admin-announcements-dashboard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export default async function AdminAnnouncementsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')

  const allowed = process.env.NODE_ENV === 'development' || getAdminEmails().includes(user.email.toLowerCase())
  if (!allowed) redirect('/albums')

  return <AdminAnnouncementsDashboard />
}

