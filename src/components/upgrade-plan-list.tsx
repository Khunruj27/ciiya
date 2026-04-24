'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { formatStorage } from '@/lib/format-storage'

type Plan = {
  id: string
  name: string
  price_thb: number
  storage_limit_bytes: number
  sort_order: number
}

type CurrentSubscription = {
  plan_id: string | null
}

type Props = {
  plans: Plan[]
  currentSubscription: CurrentSubscription | null
}

export default function UpgradePlanList({
  plans,
  currentSubscription,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null)

  const isSuccess = useMemo(
    () => searchParams.get('success') === '1',
    [searchParams]
  )

  const isCanceled = useMemo(
    () => searchParams.get('canceled') === '1',
    [searchParams]
  )

  async function handleCheckout(planId: string) {
    try {
      setLoadingPlanId(planId)

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ planId }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to continue')
      }

      if (data.url) {
        window.location.href = data.url
        return
      }

      throw new Error('Missing Stripe checkout URL')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to continue')
    } finally {
      setLoadingPlanId(null)
    }
  }

  if (!plans || plans.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl">
          📦
        </div>

        <h2 className="mt-4 text-lg font-semibold text-slate-900">
          No plans found
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          Please add plans in the database first, then reload this page.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {isSuccess ? (
        <div className="rounded-3xl bg-green-50 p-4 text-sm text-green-700 ring-1 ring-green-200">
          Payment successful.
        </div>
      ) : null}

      {isCanceled ? (
        <div className="rounded-3xl bg-yellow-50 p-4 text-sm text-yellow-700 ring-1 ring-yellow-200">
          Payment was canceled.
        </div>
      ) : null}

      {plans.map((plan) => {
        const isCurrent = currentSubscription?.plan_id === plan.id

        return (
          <div
            key={plan.id}
            className={`rounded-3xl bg-white p-5 shadow-sm ring-1 ${
              isCurrent ? 'ring-blue-500' : 'ring-black/5'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {plan.name}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Storage up to {formatStorage(Number(plan.storage_limit_bytes || 0))}
                </p>
              </div>

              {isCurrent ? (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
                  Current Plan
                </span>
              ) : null}
            </div>

            <div className="mt-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-3xl font-bold text-slate-900">
                  {plan.price_thb === 0 ? 'Free' : `฿${plan.price_thb}`}
                </p>

                <p className="text-sm text-slate-500">
                  {plan.price_thb === 0 ? 'Starter plan' : 'per month'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleCheckout(plan.id)}
                disabled={isCurrent || loadingPlanId === plan.id}
                className="rounded-2xl bg-blue-600 px-4 py-3 text-white disabled:opacity-50"
              >
                {isCurrent
                  ? 'Current'
                  : loadingPlanId === plan.id
                  ? 'Processing...'
                  : plan.price_thb === 0
                  ? 'Use Free Plan'
                  : 'Pay Now'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}