'use client'

import { useState } from 'react'

export default function ManageBillingButton() {
  const [loading, setLoading] = useState(false)

  async function handleOpenBilling() {
    try {
      setLoading(true)

      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
      })

      if (!res.ok) {
        throw new Error('Failed to open billing portal')
      }

      const data = await res.json()

      if (!data?.url) {
        throw new Error('Portal URL not found')
      }

      window.location.href = data.url
    } catch (error) {
      console.error(error)
      alert('Unable to open billing portal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleOpenBilling}
      disabled={loading}
      className="flex h-12 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? 'Opening...' : 'Manage Billing'}
    </button>
  )
}