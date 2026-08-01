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
  stripe_subscription_id?: string | null
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

    const endpoint =
      currentSubscription?.stripe_subscription_id
        ? '/api/stripe/change-plan'
        : '/api/stripe/checkout'

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        planId,
      }),
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      throw new Error(data?.error || 'Checkout failed')
    }

    if (endpoint === '/api/stripe/change-plan') {
      window.location.reload()
      return
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
      <div className="rounded-[28px] border border-dashed border-black/10 bg-[#F6F7FA] px-5 py-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl">
          📦
        </div>

        <h2 className="mt-4 text-base font-black text-[#1C0617]">
          No plans found
        </h2>

        <p className="mt-2 text-xs font-semibold leading-5 text-[#8E8E93]">
          Please add plans in the database first.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {isSuccess ? (
        <div className="rounded-[22px] border border-green-200 bg-green-50 px-4 py-3 text-xs font-bold leading-5 text-green-700">
          Payment successful. Your plan has been updated.
        </div>
      ) : null}

      {isCanceled ? (
        <div className="rounded-[22px] border border-yellow-200 bg-yellow-50 px-4 py-3 text-xs font-bold leading-5 text-yellow-700">
          Payment was canceled. You can choose another plan anytime.
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

        const storageLabel = formatStorage(
          Number(plan.storage_limit_bytes || 0)
        )

        return (
          <div
            key={plan.id}
            className={`relative overflow-hidden rounded-[30px] border p-4 transition active:scale-[0.99] ${
              isCurrent
                ? 'border-black/10 bg-[#F0B1DE]'
                : isPopular
                  ? 'border-black/10 bg-[#D0F578]'
                  : 'border-black/5 bg-[#F6F7FA]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[22px] font-black leading-none tracking-[-0.06em] text-[#1C0617]">
                    {plan.name}
                  </h2>

                  {isCurrent ? (
                    <span className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#1C0617]">
                      Current
                    </span>
                  ) : null}

                  {isPopular && !isCurrent ? (
                    <span className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#344318]">
                      Best
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 text-xs font-bold leading-5 text-[#4A3140]/75">
                  Storage up to {storageLabel}
                </p>

                {isPopular ? (
                  <p className="mt-1 text-xs font-bold leading-5 text-[#344318]">
                    Recommended for photographers and client galleries.
                  </p>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[28px] font-black leading-none tracking-[-0.07em] text-[#1C0617]">
                  {plan.price_thb === 0 ? 'Free' : `฿${plan.price_thb}`}
                </p>

                <p className="mt-1 text-[11px] font-bold text-[#8E8E93]">
                  {plan.price_thb === 0 ? 'Starter' : '/ month'}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-[20px] bg-white/65 px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#8E8E93]">
                  Space
                </p>
                <p className="mt-1 text-sm font-black text-[#1C0617]">
                  {storageLabel}
                </p>
              </div>

              <div className="rounded-[20px] bg-white/65 px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#8E8E93]">
                  Delivery
                </p>
                <p className="mt-1 text-sm font-black text-[#1C0617]">
                  Gallery
                </p>
              </div>
            </div>

            {cannotDowngrade ? (
              <p className="mt-3 rounded-[20px] bg-red-50 px-3 py-3 text-xs font-bold leading-5 text-red-600">
                ⚠️ You are using more storage than this plan allows.
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => handleCheckout(plan.id)}
              disabled={
                isCurrent || loadingPlanId === plan.id || cannotDowngrade
              }
              className={`mt-4 flex h-12 w-full items-center justify-center rounded-full text-sm font-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 ${
                isCurrent
                  ? 'bg-white/70 text-[#1C0617]'
                  : cannotDowngrade
                    ? 'bg-slate-300 text-white'
                    : 'bg-[#1C0617] text-white'
              }`}
            >
              {isCurrent
                ? 'Current Plan'
                : cannotDowngrade
                  ? 'Storage Too Large'
                  : loadingPlanId === plan.id
                    ? 'Processing...'
                    : plan.price_thb === 0
                      ? 'Use Free'
                      : isPopular
                        ? 'Upgrade Plan'
                        : 'Choose Plan'}
            </button>
          </div>
        )
      })}
    </div>
  )
}