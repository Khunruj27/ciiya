'use client'

import { useState } from 'react'

export default function BillingPortalButton() {
  const [loading, setLoading] = useState(false)

  async function openBillingPortal() {
    try {
      setLoading(true)

      const res = await fetch('/api/stripe/billing-portal', {
        method: 'POST',
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Billing portal failed')
      }

      if (!data?.url) {
        throw new Error('Missing billing portal URL')
      }

      window.location.assign(data.url)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Billing portal error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={openBillingPortal}
      disabled={loading}
      className="flex h-12 w-full items-center justify-center rounded-full border border-line bg-surface px-4 text-[14px] font-semibold text-ink transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? 'Opening...' : 'Billing'}
    </button>
  )
}