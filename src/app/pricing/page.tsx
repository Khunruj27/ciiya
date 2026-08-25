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
    <main className="min-h-screen overflow-hidden bg-ground px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[max(42px,env(safe-area-inset-bottom))] text-ink sm:px-8 lg:px-12">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(199,168,107,0.18),transparent_42%)]" />

      <div className="relative mx-auto w-full max-w-5xl">
        <div className="flex items-center justify-between">
          <Link
            href="/me"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-black/5 bg-white/80 text-2xl font-black text-[#1C0617] backdrop-blur-xl transition active:scale-95"
          >
            ‹
          </Link>

          <div className="rounded-full border border-black/5 bg-white/80 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-[#8E8E93] backdrop-blur-xl">
            แพ็กเกจ
          </div>
        </div>

        <section className="mt-8">
          <p className="text-[13px] font-black uppercase tracking-[0.18em] text-[#8E8E93]">
            พื้นที่สำหรับทุกงาน
          </p>

          <h1 className="mt-3 text-[44px] font-black leading-[0.9] tracking-[-0.08em] text-[#1C0617]">
            เลือกพื้นที่ที่พอดีกับคุณ
          </h1>
        </section>

        <section className="mt-7 rounded-hero border border-line bg-surface/90 p-4 shadow-card backdrop-blur-xl sm:p-6 lg:p-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-[24px] font-black tracking-[-0.05em]">
                แพ็กเกจที่พร้อมใช้งาน
              </h2>
              <p className="mt-1 text-xs font-semibold text-[#8E8E93]">
                เปลี่ยนแพ็กเกจได้ตามปริมาณงานของคุณ
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
                ยังไม่พบแพ็กเกจ
              </h2>

              <p className="mt-2 text-xs leading-5 text-slate-500">
                กรุณาเพิ่มข้อมูลแพ็กเกจ แล้วโหลดหน้านี้ใหม่
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
