'use client'

import { useSyncExternalStore } from 'react'
import AdminQueueDashboard from './admin-queue-dashboard'

function AdminQueueSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-32 rounded-[28px] bg-white shadow-sm ring-1 ring-black/5" />
      <div className="grid gap-4 md:grid-cols-4">
        <div className="h-28 rounded-[24px] bg-white shadow-sm ring-1 ring-black/5" />
        <div className="h-28 rounded-[24px] bg-white shadow-sm ring-1 ring-black/5" />
        <div className="h-28 rounded-[24px] bg-white shadow-sm ring-1 ring-black/5" />
        <div className="h-28 rounded-[24px] bg-white shadow-sm ring-1 ring-black/5" />
      </div>
    </div>
  )
}

export default function AdminQueueDashboardClient() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  if (!mounted) {
    return <AdminQueueSkeleton />
  }

  return <AdminQueueDashboard />
}