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
      <div className="rounded-panel border border-dashed border-line-strong bg-ground-sunken px-5 py-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl">
          📦
        </div>

        <h2 className="mt-4 text-base font-semibold text-ink">
          No plans found yet
        </h2>

        <p className="mt-2 text-xs font-semibold leading-5 text-muted">
          Please add plan data first
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {isSuccess ? (
        <div className="rounded-panel border border-green-200 bg-green-50 px-4 py-3 text-xs font-bold leading-5 text-green-700">
          Payment successful. Your plan has been updated
        </div>
      ) : null}

      {isCanceled ? (
        <div className="rounded-panel border border-yellow-200 bg-yellow-50 px-4 py-3 text-xs font-bold leading-5 text-yellow-700">
          Payment canceled. You can choose a new plan anytime
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
            className={`relative overflow-hidden rounded-panel border p-4 transition active:scale-[0.99] ${
              isCurrent
                ? 'border-gold bg-gold-soft'
                : isPopular
                  ? 'border-gold/50 bg-surface'
                  : 'border-line bg-ground'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[22px] font-semibold leading-none tracking-[-0.06em] text-ink">
                    {plan.name}
                  </h2>

                  {isCurrent ? (
                    <span className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
                      Current
                    </span>
                  ) : null}

                  {isPopular && !isCurrent ? (
                    <span className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-deep">
                      Recommended
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 text-xs font-bold leading-5 text-gold-deep/75">
                  Maximum storage {storageLabel}
                </p>

                {isPopular ? (
                  <p className="mt-1 text-xs font-bold leading-5 text-gold-deep">
                    Great for photographers and client galleries
                  </p>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[28px] font-semibold leading-none tracking-[-0.07em] text-ink">
                  {plan.price_thb === 0 ? 'Free' : `฿${plan.price_thb}`}
                </p>

                <p className="mt-1 text-[11px] font-bold text-muted">
                  {plan.price_thb === 0 ? 'Starter' : '/ month'}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-panel bg-white/65 px-3 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Storage
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {storageLabel}
                </p>
              </div>

              <div className="rounded-panel bg-white/65 px-3 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Delivery
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  Gallery
                </p>
              </div>
            </div>

            {cannotDowngrade ? (
              <p className="mt-3 rounded-panel bg-red-50 px-3 py-3 text-xs font-bold leading-5 text-red-600">
                Your current usage exceeds this plan’s limit
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => handleCheckout(plan.id)}
              disabled={
                isCurrent || loadingPlanId === plan.id || cannotDowngrade
              }
              className={`mt-4 flex h-12 w-full items-center justify-center rounded-full text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 ${
                isCurrent
                  ? 'bg-white/70 text-ink'
                  : cannotDowngrade
                    ? 'bg-line-strong text-white'
                    : 'bg-ink text-white'
              }`}
            >
              {isCurrent
                ? 'Current plan'
                : cannotDowngrade
                  ? 'Not enough space'
                  : loadingPlanId === plan.id
                    ? 'Processing…'
                    : plan.price_thb === 0
                      ? 'Use the free plan'
                      : isPopular
                        ? 'Upgrade plan'
                        : 'Choose plan'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
