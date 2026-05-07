import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-03-25.dahlia',
})

export async function POST(req: NextRequest) {
  try {
    const { targetPlanId } = await req.json()

    if (!targetPlanId) {
      return NextResponse.json({ error: 'Missing targetPlanId' }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: targetPlan, error: planError } = await supabase
      .from('plans')
      .select('id, name, price_thb, storage_limit_bytes, stripe_price_id')
      .eq('id', targetPlanId)
      .single()

    if (planError || !targetPlan) {
      return NextResponse.json({ error: 'Target plan not found' }, { status: 404 })
    }

    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('id, stripe_subscription_id, stripe_customer_id, plan_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (subError || !subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    // Free plan: ยังไม่ยุ่ง Stripe ก่อน ให้เปลี่ยนใน DB หรือทำ cancel_at_period_end ทีหลัง
    if (!targetPlan.stripe_price_id || targetPlan.price_thb === 0) {
      await supabase
        .from('subscriptions')
        .update({
          plan_id: targetPlan.id,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', subscription.id)

      return NextResponse.json({
        success: true,
        message: 'Downgraded to free plan',
      })
    }

    if (!subscription.stripe_subscription_id) {
      return NextResponse.json(
        { error: 'Missing stripe_subscription_id' },
        { status: 400 }
      )
    }

    const stripeSub = await stripe.subscriptions.retrieve(
      subscription.stripe_subscription_id
    )

    const item = stripeSub.items.data[0]

    if (!item) {
      return NextResponse.json({ error: 'Subscription item not found' }, { status: 400 })
    }

    const updated = await stripe.subscriptions.update(stripeSub.id, {
      items: [
        {
          id: item.id,
          price: targetPlan.stripe_price_id,
        },
      ],
      proration_behavior: 'none',
      metadata: {
        app_user_id: user.id,
        target_plan_id: targetPlan.id,
        change_type: 'downgrade',
      },
    })

    await supabase
      .from('subscriptions')
      .update({
        plan_id: targetPlan.id,
        stripe_subscription_id: updated.id,
        status: updated.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscription.id)

    return NextResponse.json({
      success: true,
      subscriptionId: updated.id,
      plan: targetPlan.name,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Downgrade failed',
      },
      { status: 500 }
    )
  }
}