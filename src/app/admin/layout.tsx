import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Same rule the individual admin pages already use, applied once here so the
// whole /admin subtree is gated consistently — including client-rendered pages
// (e.g. workers/live) that cannot run a server redirect themselves. In
// development the gate is open; in production only ADMIN_EMAILS may enter.
function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/login')
  }

  const isAdmin =
    process.env.NODE_ENV === 'development' ||
    getAdminEmails().includes(user.email.toLowerCase())

  if (!isAdmin) {
    redirect('/albums')
  }

  return <>{children}</>
}
