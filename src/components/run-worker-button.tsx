'use client'

import { useState } from 'react'

export default function RunWorkerButton() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function checkWorker() {
    try {
      setLoading(true)
      setMessage('Checking Railway worker...')

      const res = await fetch('/api/worker/auto', {
        method: 'GET',
        cache: 'no-store',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || 'Worker unavailable')
      }

      if (data?.disabled) {
        setMessage('Railway Worker Active')
      } else {
        setMessage('Worker Online')
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Error: ${error.message}`
          : 'Worker Error'
      )
    } finally {
      setLoading(false)

      setTimeout(() => {
        setMessage('')
      }, 2500)
    }
  }

  return (
    <button
      type="button"
      onClick={checkWorker}
      disabled={loading}
      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? 'Checking...' : 'Worker Status'}

      {message && (
        <span className="ml-3 text-xs opacity-90">
          {message}
        </span>
      )}
    </button>
  )
}