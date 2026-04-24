import Stripe from 'stripe'
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { createServerSupabaseClient } from '@/lib/supabase-server'

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

  const supabase = await createServerSupabaseClient()

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session

      const userId = session.metadata?.user_id
      const planId = session.metadata?.plan_id
      const stripeCustomerId =
        typeof session.customer === 'string' ? session.customer : null
      const stripeSubscriptionId =
        typeof session.subscription === 'string' ? session.subscription : null

      if (userId && planId && stripeSubscriptionId) {
        await supabase
          .from('subscriptions')
          .update({ status: 'canceled' })
          .eq('user_id', userId)
          .eq('status', 'active')

        await supabase.from('subscriptions').insert({
          user_id: userId,
          plan_id: planId,
          status: 'active',
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId,
        })
      }
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as any

      const stripeSubscriptionId =
        typeof invoice.subscription === 'string'
          ? invoice.subscription
          : typeof invoice.parent?.subscription_details?.subscription === 'string'
          ? invoice.parent.subscription_details.subscription
          : null

      if (stripeSubscriptionId) {
        const subscription: any = await stripe.subscriptions.retrieve(
          stripeSubscriptionId
        )

        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null

        await supabase
          .from('subscriptions')
          .update({
            status: subscription.status,
            current_period_end: periodEnd,
          })
          .eq('stripe_subscription_id', stripeSubscriptionId)
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated'
    ) {
      const subscription = event.data.object as any

      const periodEnd = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null

      await supabase
        .from('subscriptions')
        .update({
          status: subscription.status,
          current_period_end: periodEnd,
        })
        .eq('stripe_subscription_id', subscription.id)
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as any

      await supabase
        .from('subscriptions')
        .update({ status: 'canceled' })
        .eq('stripe_subscription_id', subscription.id)
    }

    return new Response('ok', { status: 200 })
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : 'Webhook handler failed',
      { status: 500 }
    )
  }
}