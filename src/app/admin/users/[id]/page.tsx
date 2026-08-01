import AdminUserDetail from '@/components/admin-user-detail'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PageProps = {
  params: Promise<{
    id: string
  }>
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  const { id } = await params

  return <AdminUserDetail userId={id} />
}