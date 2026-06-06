import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import UpgradePlanList from '@/components/upgrade-plan-list'

export default async function PricingPage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: plans, error: plansError } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (plansError) {
    throw new Error(plansError.message)
  }

  const { data: currentSubscription, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('plan_id, status, current_period_end')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (subscriptionError) {
    throw new Error(subscriptionError.message)
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#F7F8FC] px-5 pt-[max(60px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))] text-slate-950">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[280px] bg-[radial-gradient(circle_at_50%_0%,rgba(47,107,255,0.18),transparent_62%)]" />

      <div className="relative mx-auto w-full max-w-[390px]">
        <Link
          href="/albums"
          className="inline-flex h-11 items-center rounded-full bg-white/80 px-4 text-sm font-bold text-slate-500 shadow-sm ring-1 ring-black/5 backdrop-blur-xl transition active:scale-95"
        >
          ‹ Back
        </Link>

       <section className="mt-4 rounded-[28px] sm:rounded-[32px] bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black tracking-[-0.03em] text-slate-950">
                Available Plans
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Select a plan to continue.
              </p>
            </div>

            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-lg">
              ✦
            </div>
          </div>

          {plans && plans.length > 0 ? (
            <UpgradePlanList
              plans={plans}
              currentSubscription={currentSubscription}
            />
          ) : (
            <div className="rounded-[26px] border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl shadow-sm ring-1 ring-black/5">
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