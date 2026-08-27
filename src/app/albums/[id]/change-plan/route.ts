import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserStorage } from '@/lib/get-user-storage'

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { newPlanId } = await req.json()

  // Pulls plan new
  const { data: newPlan } = await supabase
    .from('plans')
    .select('*')
    .eq('id', newPlanId)
    .single()

  if (!newPlan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  // Pulls plan Current
  const { data: currentSub } = await supabase
    .from('subscriptions')
    .select('*, plan:plans(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  const currentLimit = currentSub?.plan?.storage_limit_bytes || 0
  const newLimit = newPlan.storage_limit_bytes

  // 🔥 Check whether it’s downgrade 
  const isDowngrade = newLimit < currentLimit

  if (isDowngrade) {
    const usage = await getUserStorage(user.id)

    if (usage > newLimit) {
      return NextResponse.json(
        {
          error: 'Storage exceeds new plan limit. Please delete files first.',
        },
        { status: 400 }
      )
    }
  }

  // ✅ Update plan
  await supabase
    .from('subscriptions')
    .update({ plan_id: newPlan.id })
    .eq('user_id', user.id)

  return NextResponse.json({ success: true })
}