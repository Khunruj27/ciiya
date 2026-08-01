import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import UpgradePlanList from '@/components/upgrade-plan-list'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PricingPage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: plans, error: plansError } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (plansError) throw new Error(plansError.message)

  const { data: storageUsage, error: storageUsageError } = await supabase
    .from('user_storage_usage')
    .select('current_plan, storage_limit_bytes, storage_used_bytes, used_bytes')
    .eq('user_id', user.id)
    .maybeSingle()

  if (storageUsageError) throw new Error(storageUsageError.message)

  const { data: activeSubscription } = await supabase
  .from('subscriptions')
  .select(`
    plan_id,
    stripe_subscription_id,
    plan:plans (
      storage_limit_bytes
    )
  `)
  .eq('user_id', user.id)
  .eq('status', 'active')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle()

const activePlan = Array.isArray(activeSubscription?.plan)
  ? activeSubscription?.plan[0]
  : activeSubscription?.plan

const currentSubscription = activeSubscription
  ? {
      plan_id: activeSubscription.plan_id,
      stripe_subscription_id: activeSubscription.stripe_subscription_id,
      storage_limit_bytes: Number(activePlan?.storage_limit_bytes || 0),
    }
  : null

  const totalBytes = Number(
    storageUsage?.storage_used_bytes ?? storageUsage?.used_bytes ?? 0
  )

  return (
    <main className="min-h-screen overflow-hidden bg-[#FAF7F4] px-5 pt-[max(54px,env(safe-area-inset-top))] pb-[max(42px,env(safe-area-inset-bottom))] text-[#1C0617]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(240,177,222,0.32),transparent_38%),radial-gradient(circle_at_100%_20%,rgba(208,245,120,0.22),transparent_32%)]" />

      <div className="relative mx-auto w-full max-w-[393px]">
        <div className="flex items-center justify-between">
          <Link
            href="/me"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-black/5 bg-white/80 text-2xl font-black text-[#1C0617] backdrop-blur-xl transition active:scale-95"
          >
            ‹
          </Link>

          <div className="rounded-full border border-black/5 bg-white/80 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-[#8E8E93] backdrop-blur-xl">
            Pricing
          </div>
        </div>

        <section className="mt-8">
          <p className="text-[13px] font-black uppercase tracking-[0.18em] text-[#8E8E93]">
            Storage Plans
          </p>

          <h1 className="mt-3 text-[44px] font-black leading-[0.9] tracking-[-0.08em] text-[#1C0617]">
            Upgrade your space.
          </h1>
        </section>

        <section className="mt-5 rounded-[32px] border border-black/5 bg-white/90 p-4 backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-[24px] font-black tracking-[-0.05em]">
                Available Plans
              </h2>
              <p className="mt-1 text-xs font-semibold text-[#8E8E93]">
                Upgrade, downgrade, or keep your current plan.
              </p>
            </div>

            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F6F7FA] text-xl">
              ✦
            </div>
          </div>

          {plans && plans.length > 0 ? (
            <UpgradePlanList
              plans={plans}
              currentSubscription={currentSubscription}
              totalBytes={totalBytes}
            />
          ) : (
            <div className="rounded-[26px] border border-dashed border-slate-300 bg-[#F6F7FA] p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl">
                📦
              </div>

              <h2 className="mt-4 text-base font-black text-slate-900">
                No plans found
              </h2>

              <p className="mt-2 text-xs leading-5 text-slate-500">
                Please add plans in the database first, then reload this page.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}