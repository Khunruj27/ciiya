'use client'

import { useState } from 'react'

export default function RunWorkerButton() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function runWorker() {
    try {
      setLoading(true)
      setMessage('กำลังรัน worker...')

      const res = await fetch('/api/worker/process-photos?limit=5', {
        method: 'POST',
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Worker failed')
      }

      setMessage(
        `สำเร็จ ${data.processed ?? data.started ?? 0} jobs`
      )

      setTimeout(() => {
        window.location.reload()
      }, 1200)
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
      onClick={runWorker}
      disabled={loading}
      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? 'กำลังรัน...' : 'Run Worker'}
      {message && (
        <span className="ml-3 text-xs opacity-90">
          {message}
        </span>
      )}
    </button>
  )
}