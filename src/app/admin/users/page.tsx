import AdminUsersDashboard from '@/components/admin-users-dashboard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminUsersPage() {
  return <AdminUsersDashboard />
}