import Stripe from 'stripe'
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

type StripeSubscriptionWithPeriod = Stripe.Subscription & {
  current_period_end?: number | null
}

// Stripe API 2026-05-27.dahlia moved current_period_end off the
// subscription object and onto each subscription item — subscription.
// current_period_end is always undefined now. Read it from the first item
// instead, since this app only ever puts one price per subscription.
function getCurrentPeriodEnd(subscription: StripeSubscriptionWithPeriod) {
  return (
    subscription.items?.data?.[0]?.current_period_end ??
    subscription.current_period_end ??
    null
  )
}

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

async function syncSubscription(stripeSubscriptionId: string) {
  const supabase = getAdminSupabase()

  const subscription = (await stripe.subscriptions.retrieve(
    stripeSubscriptionId,
    { expand: ['items.data.price'] }
  )) as StripeSubscriptionWithPeriod

  const priceId = subscription.items?.data?.[0]?.price?.id
  const userId = subscription.metadata?.user_id
  const stripeCustomerId =
    typeof subscription.customer === 'string' ? subscription.customer : null

  if (!priceId || !userId) return

  const periodEndSeconds = getCurrentPeriodEnd(subscription)
  const currentPeriodEndIso = periodEndSeconds
    ? new Date(periodEndSeconds * 1000).toISOString()
    : null

  const { data: plan, error: planError } = await supabase
    .from('plans')
    .select('id, slug, storage_limit_bytes')
    .eq('stripe_price_id', priceId)
    .single()

  if (planError || !plan) {
    console.error('Plan not found for price:', priceId)
    return
  }

  await supabase
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('user_id', userId)
    .eq('status', 'active')
    .neq('stripe_subscription_id', subscription.id)

  const { error: subError } = await supabase
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        plan_id: plan.id,
        status: subscription.status || 'active',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: subscription.id,
        current_period_end: currentPeriodEndIso,
      },
      {
        onConflict: 'stripe_subscription_id',
      }
    )

  if (subError) {
    console.error('Upsert subscription failed:', subError.message)
    return
  }

  const { error: usageError } = await supabase
  .from('user_storage_usage')
  .upsert(
    {
      user_id: userId,
      current_plan: plan.slug,
      storage_limit_bytes: Number(plan.storage_limit_bytes || 0),
      current_period_end: currentPeriodEndIso,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )

if (usageError) {
  console.error('Update user_storage_usage failed:', usageError.message)
}
}

export async function POST(req: Request) {
  const body = await req.text()
  const signature = (await headers()).get('stripe-signature')

  if (!signature) {
    return new Response('Missing stripe-signature', { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    return new Response(
      `Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      { status: 400 }
    )
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session

      const stripeSubscriptionId =
        typeof session.subscription === 'string' ? session.subscription : null

      if (stripeSubscriptionId) {
        await syncSubscription(stripeSubscriptionId)
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated'
    ) {
      const subscription = event.data.object as Stripe.Subscription
      await syncSubscription(subscription.id)
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription
      const supabase = getAdminSupabase()

      await supabase
        .from('subscriptions')
        .update({ status: 'canceled' })
        .eq('stripe_subscription_id', subscription.id)
    }

    return new Response('ok', { status: 200 })
  } catch (error) {
    console.error('Webhook handler failed:', error)

    return new Response(
      error instanceof Error ? error.message : 'Webhook handler failed',
      { status: 500 }
    )
  }
}