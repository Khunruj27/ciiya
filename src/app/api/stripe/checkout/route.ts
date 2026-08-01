import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || !user.email) {
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

    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('*')
      .eq('id', planId)
      .eq('is_active', true)
      .single()

    if (planError || !plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    if (!plan.stripe_price_id) {
      return NextResponse.json(
        { error: 'This plan is not connected to Stripe yet' },
        { status: 400 }
      )
    }

    const { data: activeSubscription } = await supabase
  .from('subscriptions')
  .select('id')
  .eq('user_id', user.id)
  .eq('status', 'active')
  .maybeSingle()

if (activeSubscription) {
  return NextResponse.json(
    {
      error: 'You already have an active subscription.',
    },
    {
      status: 400,
    }
  )
}

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

    let customerId: string | null = null

    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .not('stripe_customer_id', 'is', null)
      .limit(1)
      .maybeSingle()

  if (existingSub?.stripe_customer_id) {
  customerId = String(existingSub.stripe_customer_id)
} else {
  const customers = await stripe.customers.list({
    email: user.email,
    limit: 1,
  })

  if (customers.data.length > 0) {
    customerId = customers.data[0].id
  } else {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: {
        user_id: user.id,
      },
    })

    customerId = customer.id
  }

  // Note: there is no unique constraint on `user_id` (a user can have
  // several historical subscription rows keyed by stripe_subscription_id),
  // so we cannot upsert on that column. Update the most recent row instead,
  // or insert a fresh one if none exists yet.
  const { data: mostRecentSub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const customerSaveError = mostRecentSub?.id
    ? (
        await supabase
          .from('subscriptions')
          .update({ stripe_customer_id: customerId })
          .eq('id', mostRecentSub.id)
      ).error
    : (
        await supabase.from('subscriptions').insert({
          user_id: user.id,
          stripe_customer_id: customerId,
          status: 'inactive',
        })
      ).error

  if (customerSaveError) {
    console.error(
      'Save Stripe customer id failed:',
      customerSaveError.message
    )
  }
}

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',

      ...(customerId ? { customer: customerId } : {}),

      line_items: [
        {
          price: String(plan.stripe_price_id),
          quantity: 1,
        },
      ],

      success_url: `${siteUrl}/pricing?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/pricing?canceled=1`,

      metadata: {
        user_id: user.id,
        plan_id: String(plan.id),
      },

      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_id: String(plan.id),
        },
      },
    })

    if (!session.url) {
      return NextResponse.json(
        { error: 'Failed to create checkout session' },
        { status: 500 }
      )
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Stripe checkout error:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Checkout failed',
      },
      { status: 500 }
    )
  }
}