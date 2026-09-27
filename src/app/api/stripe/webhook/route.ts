import Stripe from 'stripe'
import { headers } from 'next/headers'
import { stripe, stripeConfig } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'
import {
  getStripePriceColumn,
  stripeModeFromLivemode,
  type StripeMode,
} from '@/lib/stripe-config'

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

async function revokeSubscriptionEntitlement(params: {
  subscriptionId: string
  userId?: string | null
  mode: StripeMode
  status?: string
}) {
  const supabase = getAdminSupabase()
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', params.subscriptionId)
    .eq('stripe_mode', params.mode)
    .maybeSingle()
  const userId = params.userId || existing?.user_id

  await supabase
    .from('subscriptions')
    .update({ status: params.status || 'canceled' })
    .eq('stripe_subscription_id', params.subscriptionId)
    .eq('stripe_mode', params.mode)

  if (!userId) return

  const { data: freePlan } = await supabase
    .from('plans')
    .select('slug, storage_limit_bytes')
    .eq('slug', 'free')
    .maybeSingle()

  if (!freePlan) {
    console.error('Cannot revoke Stripe entitlement: free plan not found.')
    return
  }

  const { error } = await supabase
    .from('user_storage_usage')
    .upsert(
      {
        user_id: userId,
        current_plan: freePlan.slug,
        storage_limit_bytes: Number(freePlan.storage_limit_bytes || 0),
        pending_plan: null,
        downgrade_scheduled_at: null,
        current_period_end: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

  if (error) {
    console.error('Revoke Stripe storage entitlement failed:', error.message)
  }
}

async function syncSubscription(
  stripeSubscriptionId: string,
  mode: StripeMode = stripeConfig.mode
) {
  const supabase = getAdminSupabase()

  const subscription = (await stripe.subscriptions.retrieve(
    stripeSubscriptionId,
    { expand: ['items.data.price'] }
  )) as StripeSubscriptionWithPeriod

  const subscriptionMode = stripeModeFromLivemode(subscription.livemode)

  if (subscriptionMode !== mode || mode !== stripeConfig.mode) {
    throw new Error('Stripe subscription mode does not match this deployment.')
  }

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
    .eq(getStripePriceColumn(mode), priceId)
    .single()

  if (planError || !plan) {
    console.error('Plan not found for price:', priceId)
    return
  }

  await supabase
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('user_id', userId)
    .eq('stripe_mode', mode)
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
        stripe_mode: mode,
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

  if (
    subscription.status === 'canceled' ||
    subscription.status === 'unpaid' ||
    subscription.status === 'incomplete_expired'
  ) {
    await revokeSubscriptionEntitlement({
      subscriptionId: subscription.id,
      userId,
      mode,
      status: subscription.status,
    })
    return
  }

  if (
    subscription.status !== 'active' &&
    subscription.status !== 'trialing' &&
    subscription.status !== 'past_due'
  ) {
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

function getCheckoutSubscriptionId(session: Stripe.Checkout.Session) {
  return typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id ?? null
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const subscription = invoice.parent?.subscription_details?.subscription
  return typeof subscription === 'string'
    ? subscription
    : subscription?.id ?? null
}

export async function POST(req: Request) {
  const body = await req.text()
  const signature = (await headers()).get('stripe-signature')

  if (!signature) {
    return new Response('Missing stripe-signature', { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()

  if (!webhookSecret) {
    console.error('Stripe webhook secret is not configured.')
    return new Response('Webhook unavailable', { status: 503 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    )
  } catch (err) {
    console.warn(
      'Stripe webhook signature verification failed:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return new Response('Invalid webhook signature', { status: 400 })
  }

  try {
    const eventMode = stripeModeFromLivemode(event.livemode)

    if (eventMode !== stripeConfig.mode) {
      return new Response('Stripe event mode mismatch', { status: 400 })
    }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session

      const stripeSubscriptionId = getCheckoutSubscriptionId(session)

      if (stripeSubscriptionId && session.payment_status !== 'unpaid') {
        await syncSubscription(stripeSubscriptionId, eventMode)
      }
    }

    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session
      const stripeSubscriptionId = getCheckoutSubscriptionId(session)

      if (stripeSubscriptionId) {
        await syncSubscription(stripeSubscriptionId, eventMode)
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated'
    ) {
      const subscription = event.data.object as Stripe.Subscription
      await syncSubscription(subscription.id, eventMode)
    }

    if (
      event.type === 'invoice.paid' ||
      event.type === 'invoice.payment_failed'
    ) {
      const invoice = event.data.object as Stripe.Invoice
      const stripeSubscriptionId = getInvoiceSubscriptionId(invoice)

      if (stripeSubscriptionId) {
        await syncSubscription(stripeSubscriptionId, eventMode)
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription
      await revokeSubscriptionEntitlement({
        subscriptionId: subscription.id,
        userId: subscription.metadata?.user_id,
        mode: eventMode,
        status: 'canceled',
      })
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
