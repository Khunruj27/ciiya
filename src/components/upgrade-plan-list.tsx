'use client'

import { useSearchParams } from 'next/navigation'
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
  storage_limit_bytes?: number
}

type Props = {
  plans: Plan[]
  currentSubscription: CurrentSubscription | null
  totalBytes?: number
}

export default function UpgradePlanList({
  plans,
  currentSubscription,
  totalBytes = 0,
}: Props) {
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

  const mostPopularPlanId = useMemo(() => {
    return (
      plans.find(
        (plan) => Number(plan.storage_limit_bytes) === 50 * 1024 * 1024 * 1024
      )?.id ||
      plans.find((plan) => plan.name.toLowerCase().includes('50'))?.id ||
      plans[Math.floor(plans.length / 2)]?.id
    )
  }, [plans])

  async function handleCheckout(planId: string) {
    try {
      setLoadingPlanId(planId)

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Checkout failed')
      }

      if (!data?.url) {
        throw new Error('Missing checkout URL')
      }

      window.location.assign(data.url)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Checkout error')
    } finally {
      setLoadingPlanId(null)
    }
  }

  if (!plans || plans.length === 0) {
    return (
      <div className="rounded-[20px] border border-dashed border-slate-300 bg-white px-5 py-6 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-lg">
          📦
        </div>

        <h2 className="mt-3 text-[15px] font-semibold leading-tight text-slate-950">
          No plans found
        </h2>

        <p className="mt-1 text-[12px] leading-5 text-slate-500">
          Please add plans in the database first.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {isSuccess ? (
        <div className="rounded-[18px] bg-green-50 px-4 py-2.5 text-[12px] font-medium leading-5 text-green-700 ring-1 ring-green-200">
          Payment successful.
        </div>
      ) : null}

      {isCanceled ? (
        <div className="rounded-[18px] bg-yellow-50 px-4 py-2.5 text-[12px] font-medium leading-5 text-yellow-700 ring-1 ring-yellow-200">
          Payment was canceled.
        </div>
      ) : null}

      {plans.map((plan) => {
        const isCurrent = currentSubscription?.plan_id === plan.id
        const isPopular = plan.id === mostPopularPlanId

        const isDowngrade = Boolean(
          currentSubscription?.storage_limit_bytes &&
            plan.storage_limit_bytes < currentSubscription.storage_limit_bytes
        )

        const cannotDowngrade =
          isDowngrade && totalBytes > plan.storage_limit_bytes

        return (
          <div
            key={plan.id}
            className={`relative overflow-hidden rounded-[20px] p-[1px] ${
              isPopular && !isCurrent
                ? 'bg-gradient-to-br from-[#0A84FF] via-[#64D2FF] to-[#5E5CE6] shadow-[0_14px_34px_rgba(10,132,255,0.14)]'
                : isCurrent
                ? 'bg-[#0A84FF] shadow-[0_10px_26px_rgba(10,132,255,0.10)]'
                : 'bg-slate-200/80'
            }`}
          >
            <div
              className={`relative rounded-[19px] bg-white px-4 py-3 ${
                isPopular && !isCurrent
                  ? 'bg-gradient-to-br from-white via-[#FAFCFF] to-[#EEF6FF]'
                  : ''
              }`}
            >
              {isPopular && !isCurrent ? (
                <div className="absolute right-3 top-3">
                  <span className="rounded-full bg-[#0A84FF] px-2.5 py-1 text-[10px] font-semibold leading-none text-white shadow-sm">
                    Best Value
                  </span>
                </div>
              ) : null}

              {isCurrent ? (
                <div className="absolute right-3 top-3">
                  <span className="rounded-full bg-[#EEF6FF] px-2.5 py-1 text-[10px] font-semibold leading-none text-[#0A84FF]">
                    Current
                  </span>
                </div>
              ) : null}

              <div className="pr-20">
                <h2 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-slate-950">
                  {plan.name}
                </h2>

                <p className="mt-1 text-[12px] leading-4 text-slate-500">
                  Storage up to{' '}
                  {formatStorage(Number(plan.storage_limit_bytes || 0))}
                </p>

                {isPopular ? (
                  <p className="mt-0.5 text-[11px] leading-4 text-[#0A84FF]">
                    Recommended for photographers
                  </p>
                ) : null}
              </div>

              {cannotDowngrade ? (
                <p className="mt-2.5 rounded-[14px] bg-red-50 px-3 py-2 text-[11px] leading-4 text-red-600">
                  ⚠️ You are using more storage than this plan allows.
                </p>
              ) : null}

              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[24px] font-semibold leading-none tracking-[-0.04em] text-slate-950">
                    {plan.price_thb === 0 ? 'Free' : `฿${plan.price_thb}`}
                  </p>

                  <p className="mt-1 text-[11px] leading-none text-slate-500">
                    {plan.price_thb === 0 ? 'Starter plan' : 'per month'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleCheckout(plan.id)}
                  disabled={
                    isCurrent || loadingPlanId === plan.id || cannotDowngrade
                  }
                  className={`min-w-[86px] rounded-full px-3.5 py-2 text-[12px] font-semibold leading-none shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 ${
                    isCurrent
                      ? 'bg-slate-300 text-[#0A84FF]'
                      : cannotDowngrade
                      ? 'bg-slate-300 text-white'
                      : isPopular
                      ? 'bg-[#0A84FF] text-white shadow-[0_8px_18px_rgba(10,132,255,0.22)]'
                      : 'bg-slate-950 text-white'
                  }`}
                >
                  {isCurrent
                    ? 'Current'
                    : cannotDowngrade
                    ? 'Too large'
                    : loadingPlanId === plan.id
                    ? 'Processing'
                    : plan.price_thb === 0
                    ? 'Use Free'
                    : isPopular
                    ? 'Upgrade 🚀'
                    : 'Choose'}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}