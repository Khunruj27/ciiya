'use client'

import { useState } from 'react'

export default function RetryFailedWorkerButton() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function retryFailedJobs() {
    try {
      setLoading(true)
      setMessage('กำลังกู้ failed jobs...')

      const res = await fetch('/api/worker/retry-failed', {
        method: 'POST',
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Retry failed')
      }

      setMessage(`กู้สำเร็จ ${data.retried ?? 0} jobs`)
      window.location.reload()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `เกิดข้อผิดพลาด: ${error.message}`
          : 'เกิดข้อผิดพลาด'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={retryFailedJobs}
      disabled={loading}
      className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-orange-700 disabled:opacity-50"
    >
      {loading ? 'กำลังกู้...' : 'Retry Failed Jobs'}
      {message && <span className="ml-3 text-xs opacity-90">{message}</span>}
    </button>
  )
}