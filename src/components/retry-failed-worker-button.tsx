'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RetryFailedWorkerButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function retryFailedJobs() {
    try {
      setLoading(true)
      setMessage('Recovering failed jobs...')

      const res = await fetch('/api/worker/retry-failed', {
        method: 'POST',
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Retry failed')
      }

      setMessage(`Recovered ${data.retried ?? 0} jobs`)
      router.refresh()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `An error occurred: ${error.message}`
          : 'An error occurred'
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
      {loading ? 'Recovering...' : 'Retry Failed Jobs'}
      {message && <span className="ml-3 text-xs opacity-90">{message}</span>}
    </button>
  )
}