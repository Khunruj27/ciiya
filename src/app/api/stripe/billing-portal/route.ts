import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { stripe, stripeConfig } from '@/lib/stripe'
import { getStripeSiteUrl } from '@/lib/stripe-config'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rate = await rateLimit(request, {
      bucket: 'stripe-billing-portal',
      identifier: user.id,
      limit: 20,
      windowSeconds: 60 * 60,
    })

    if (!rate.allowed) return tooManyRequests(rate)

    const { data: subscription, error: subscriptionError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .eq('stripe_mode', stripeConfig.mode)
      .not('stripe_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (subscriptionError) {
      throw new Error(
        `Read Stripe customer mapping failed: ${subscriptionError.message}`
      )
    }

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No Stripe customer found' },
        { status: 404 }
      )
    }

    const siteUrl = getStripeSiteUrl()

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${siteUrl}/me`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (error) {
    console.error('Billing portal error:', error)

    return NextResponse.json(
      {
        error: 'Unable to open billing management. Please try again.',
      },
      { status: 500 }
    )
  }
}
