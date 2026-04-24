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
    <main className="min-h-screen bg-slate-50 px-4 py-6 pb-24">
      <div className="mx-auto max-w-md space-y-4">
        <Link
          href="/albums"
          className="text-xs uppercase tracking-[0.2em] text-slate-400"
        >
          ← Back to Albums
        </Link>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h1 className="text-3xl font-bold text-slate-900">Upgrade Plan</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Choose the storage plan that fits your workflow.
          </p>
        </div>

        {plans && plans.length > 0 ? (
          <UpgradePlanList
            plans={plans}
            currentSubscription={currentSubscription}
          />
        ) : (
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
        )}
      </div>
    </main>
  )
}