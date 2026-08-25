'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  targetPlanId: string
  targetPlanName: string
}

export default function DowngradePlanButton({
  targetPlanId,
  targetPlanName,
}: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDowngrade() {
    const ok = confirm(`Downgrade to ${targetPlanName}?`)
    if (!ok) return

    try {
      setLoading(true)

      const res = await fetch('/api/stripe/downgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPlanId }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        alert(data?.error || 'Downgrade failed')
        return
      }

      alert(`Downgraded to ${targetPlanName}`)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDowngrade}
      disabled={loading}
      className="rounded-full border border-line-strong bg-white px-4 py-2 text-sm font-bold text-ink-soft disabled:opacity-50"
    >
      {loading ? 'Downgrading...' : `Downgrade to ${targetPlanName}`}
    </button>
  )
}