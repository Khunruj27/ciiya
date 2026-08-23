import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const planId = String(body?.planId || '').trim()

    if (!planId) {
      return NextResponse.json(
        { error: 'planId is required' },
        { status: 400 }
      )
    }

    const admin = getAdminSupabase()

    const { data: plan, error: planError } = await admin
      .from('plans')
      .select('id, slug, name, price_thb, stripe_price_id, storage_limit_bytes')
      .eq('id', planId)
      .eq('is_active', true)
      .single()

    if (planError || !plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    if (!plan.stripe_price_id) {
      return NextResponse.json(
        { error: 'Free plan must be managed from billing portal.' },
        { status: 400 }
      )
    }

    const { data: usage } = await admin
      .from('user_storage_usage')
      .select('storage_used_bytes, used_bytes')
      .eq('user_id', user.id)
      .maybeSingle()

    const usedBytes = Number(
      usage?.storage_used_bytes ?? usage?.used_bytes ?? 0
    )

    if (usedBytes > Number(plan.storage_limit_bytes || 0)) {
      return NextResponse.json(
        { error: 'Storage usage exceeds this plan limit.' },
        { status: 400 }
      )
    }

    const { data: activeSub, error: subError } = await admin
      .from('subscriptions')
      .select('id, stripe_subscription_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .not('stripe_subscription_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (subError) {
      return NextResponse.json({ error: subError.message }, { status: 500 })
    }

    if (!activeSub?.stripe_subscription_id) {
      return NextResponse.json(
        { error: 'No active subscription found. Use checkout first.' },
        { status: 400 }
      )
    }

    const subscription = await stripe.subscriptions.retrieve(
      activeSub.stripe_subscription_id,
      {
        expand: ['items.data.price'],
      }
    )

    const itemId = subscription.items.data[0]?.id

    if (!itemId) {
      return NextResponse.json(
        { error: 'Subscription item not found.' },
        { status: 400 }
      )
    }

    const { data: currentUsage } = await admin
  .from('user_storage_usage')
  .select('current_plan, storage_limit_bytes')
  .eq('user_id', user.id)
  .maybeSingle()

const currentLimitBytes = Number(
  currentUsage?.storage_limit_bytes || 0
)

const newLimitBytes = Number(
  plan.storage_limit_bytes || 0
)

const isDowngrade =
  currentLimitBytes > 0 &&
  newLimitBytes < currentLimitBytes

const updatedSubscription = await stripe.subscriptions.update(
  activeSub.stripe_subscription_id,
  {
    items: [
      {
        id: itemId,
        price: String(plan.stripe_price_id),
      },
    ],

    proration_behavior: isDowngrade
      ? 'none'
      : 'create_prorations',

    billing_cycle_anchor: isDowngrade
      ? 'unchanged'
      : undefined,

    metadata: {
      user_id: user.id,
      plan_id: String(plan.id),
      pending_plan: isDowngrade ? plan.slug : '',
    },
  }
)

    // Stripe API 2026-05-27.dahlia moved current_period_end off the
    // subscription object and onto each subscription item.
    const periodEndSeconds =
      updatedSubscription.items.data[0]?.current_period_end ?? null
    const currentPeriodEndIso = periodEndSeconds
      ? new Date(periodEndSeconds * 1000).toISOString()
      : null

    await admin
      .from('subscriptions')
      .update({ status: 'canceled' })
      .eq('user_id', user.id)
      .eq('status', 'active')
      .neq('stripe_subscription_id', updatedSubscription.id)

    await admin.from('subscriptions').upsert(
      {
        user_id: user.id,
        plan_id: plan.id,
        status: updatedSubscription.status || 'active',
        stripe_customer_id:
          typeof updatedSubscription.customer === 'string'
            ? updatedSubscription.customer
            : null,
        stripe_subscription_id: updatedSubscription.id,
        current_period_end: currentPeriodEndIso,
      },
      {
        onConflict: 'stripe_subscription_id',
      }
    )

   await admin.from('user_storage_usage').upsert(
  {
    user_id: user.id,

    current_plan: isDowngrade
      ? currentUsage?.current_plan || 'free'
      : plan.slug,

    storage_limit_bytes: isDowngrade
      ? currentLimitBytes
      : Number(plan.storage_limit_bytes || 0),

    pending_plan: isDowngrade
      ? plan.slug
      : null,

    downgrade_scheduled_at: isDowngrade
      ? new Date().toISOString()
      : null,

    current_period_end: currentPeriodEndIso,

    updated_at: new Date().toISOString(),
  },
  {
    onConflict: 'user_id',
  }
)

    return NextResponse.json({
      success: true,
      plan: plan.slug,
      subscriptionId: updatedSubscription.id,
    })
  } catch (error) {
    console.error('Change plan failed:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Change plan failed',
      },
      { status: 500 }
    )
  }
}