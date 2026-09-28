import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { stripe, stripeConfig } from '@/lib/stripe'
import {
  getStripePriceId,
  getStripeSiteUrl,
  getStripeLiveCheckoutRolloutMode,
  getStripeWebhookCanaryEventIdPrefix,
  getStripeWebhookConfigFingerprint,
  isStripeCheckoutEnabled,
  isStripeLiveCheckoutOwnerAllowed,
  STRIPE_CHECKOUT_INTEGRATION_IDENTIFIER,
} from '@/lib/stripe-config'
import { STRIPE_MANAGED_SUBSCRIPTION_STATUSES } from '@/lib/stripe-billing'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'

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

function getCheckoutIdempotencyKey(params: {
  userId: string
  planId: string
  attemptToken: string
}) {
  const fingerprint = [
    stripeConfig.mode,
    params.userId,
    params.planId,
    params.attemptToken,
  ].join('|')
  const digest = createHash('sha256').update(fingerprint).digest('hex')

  return `ciiya-checkout-${stripeConfig.mode}-${digest}`
}

type CheckoutAttemptClaim = {
  claimed: boolean
  attemptToken: string | null
  attemptStatus: string
  existingPlanId: string | null
  sessionId: string | null
  expiresAt: string | null
}

async function claimCheckoutAttempt(
  admin: SupabaseClient,
  userId: string,
  planId: string,
  requestedExpiresAt: string
): Promise<CheckoutAttemptClaim> {
  const { data, error } = await admin.rpc('claim_stripe_checkout_attempt', {
    p_user_id: userId,
    p_stripe_mode: stripeConfig.mode,
    p_plan_id: planId,
    p_expires_at: requestedExpiresAt,
  })

  if (error) {
    if (stripeConfig.mode === 'live') {
      throw new Error(`Claim Stripe checkout attempt failed: ${error.message}`)
    }

    console.warn(
      'Stripe checkout lock unavailable in Test mode; using server idempotency fallback:',
      error.message
    )
    return {
      claimed: true,
      attemptToken: null,
      attemptStatus: 'fallback',
      existingPlanId: null,
      sessionId: null,
      expiresAt: null,
    }
  }

  const row = Array.isArray(data) ? data[0] : data

  return {
    claimed: Boolean(row?.claimed),
    attemptToken: row?.attempt_token ? String(row.attempt_token) : null,
    attemptStatus: String(row?.attempt_status || 'unknown'),
    existingPlanId: row?.existing_plan_id
      ? String(row.existing_plan_id)
      : null,
    sessionId: row?.stripe_checkout_session_id
      ? String(row.stripe_checkout_session_id)
      : null,
    expiresAt: row?.expires_at ? String(row.expires_at) : null,
  }
}

function retryAfterSeconds(expiresAt: string | null) {
  if (!expiresAt) return 60

  const remaining = Math.ceil(
    (new Date(expiresAt).getTime() - Date.now()) / 1_000
  )

  return Math.max(1, Math.min(remaining, 3_600))
}

function getCheckoutSubscriptionId(session: Stripe.Checkout.Session) {
  return typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id ?? null
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isStripeCheckoutEnabled()) {
      return NextResponse.json(
        { error: 'New subscriptions are temporarily unavailable.' },
        { status: 503 }
      )
    }

    if (
      stripeConfig.mode === 'live' &&
      !isStripeLiveCheckoutOwnerAllowed(user.id)
    ) {
      return NextResponse.json(
        { error: 'Live subscriptions are currently limited to the billing canary.' },
        { status: 503 }
      )
    }

    const rate = await rateLimit(req, {
      bucket: 'stripe-checkout',
      identifier: user.id,
      limit: 10,
      windowSeconds: 60 * 60,
    })

    if (!rate.allowed) return tooManyRequests(rate)

    const body = await req.json().catch(() => null)
    const planId = String(body?.planId || '').trim()

    if (!planId) {
      return NextResponse.json(
        { error: 'planId is required' },
        { status: 400 }
      )
    }

    const admin = getAdminSupabase()

    if (stripeConfig.mode === 'live') {
      const liveWebhookSecret = process.env.STRIPE_LIVE_WEBHOOK_SECRET!.trim()
      const webhookEndpoint = `${getStripeSiteUrl()}/api/stripe/webhook`
      const expectedAccountId =
        process.env.STRIPE_EXPECTED_LIVE_ACCOUNT_ID?.trim() || ''
      const rolloutMode = getStripeLiveCheckoutRolloutMode()

      if (rolloutMode === 'all') {
        const configFingerprint = getStripeWebhookConfigFingerprint(
          liveWebhookSecret,
          webhookEndpoint,
          expectedAccountId
        )
        const { data: originProof, error: originProofError } = await admin
          .from('stripe_webhook_origin_verifications')
          .select('config_fingerprint, verified_at')
          .eq('config_fingerprint', configFingerprint)
          .eq('stripe_account_id', expectedAccountId)
          .eq('webhook_endpoint', webhookEndpoint)
          .maybeSingle()

        if (originProofError) {
          throw new Error(
            `Verify Stripe-origin billing event failed: ${originProofError.message}`
          )
        }

        if (!originProof) {
          return NextResponse.json(
            {
              error:
                'New subscriptions are temporarily unavailable while Stripe-origin billing is verified.',
            },
            { status: 503 }
          )
        }
      } else {
        const webhookCanaryEventIdPrefix =
          getStripeWebhookCanaryEventIdPrefix(
            liveWebhookSecret,
            webhookEndpoint,
            expectedAccountId
          )
        const webhookCanaryCutoff = new Date(
          Date.now() - 24 * 60 * 60 * 1_000
        ).toISOString()
        const { data: webhookCanary, error: webhookCanaryError } = await admin
          .from('stripe_webhook_events')
          .select('event_id, completed_at')
          .eq('event_type', 'ciiya.webhook_canary')
          .eq('livemode', true)
          .eq('status', 'completed')
          .like('event_id', `${webhookCanaryEventIdPrefix}%`)
          .gte('completed_at', webhookCanaryCutoff)
          .limit(1)
          .maybeSingle()

        if (webhookCanaryError) {
          throw new Error(
            `Verify Live Stripe webhook canary failed: ${webhookCanaryError.message}`
          )
        }

        if (!webhookCanary) {
          return NextResponse.json(
            {
              error:
                'New subscriptions are temporarily unavailable while billing connectivity is verified.',
            },
            { status: 503 }
          )
        }
      }
    }

    const { data: plan, error: planError } = await admin
      .from('plans')
      .select(
        'id, slug, name, price_thb, storage_limit_bytes, stripe_price_id, stripe_live_price_id'
      )
      .eq('id', planId)
      .eq('is_active', true)
      .single()

    if (planError || !plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const stripePriceId = getStripePriceId(plan, stripeConfig.mode)

    if (!stripePriceId) {
      return NextResponse.json(
        {
          error: `This plan is not connected to Stripe ${stripeConfig.mode} mode yet`,
        },
        { status: 400 }
      )
    }

    const { data: managedSubscription, error: managedSubscriptionError } =
      await admin
        .from('subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('stripe_mode', stripeConfig.mode)
        .in('status', [...STRIPE_MANAGED_SUBSCRIPTION_STATUSES])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (managedSubscriptionError) {
      throw new Error(
        `Check existing Stripe subscription failed: ${managedSubscriptionError.message}`
      )
    }

    if (managedSubscription) {
      return NextResponse.json(
        {
          error:
            'A Stripe subscription already exists. Open billing management to change or repair it.',
        },
        { status: 409 }
      )
    }

    const siteUrl = getStripeSiteUrl()

    let customerId: string | null = null

    const { data: existingSub, error: existingSubError } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .eq('stripe_mode', stripeConfig.mode)
      .not('stripe_customer_id', 'is', null)
      .limit(1)
      .maybeSingle()

    if (existingSubError) {
      throw new Error(
        `Read Stripe customer mapping failed: ${existingSubError.message}`
      )
    }

    if (existingSub?.stripe_customer_id) {
      customerId = String(existingSub.stripe_customer_id)
    } else {
      const customers = await stripe.customers.list({
        email: user.email,
        limit: 100,
      })
      const ownedCustomer = customers.data.find(
        (customer) => customer.metadata?.user_id === user.id
      )

      if (ownedCustomer) {
        customerId = ownedCustomer.id
      } else {
        const customer = await stripe.customers.create(
          {
            email: user.email,
            metadata: {
              user_id: user.id,
            },
          },
          {
            idempotencyKey: `ciiya-customer-${stripeConfig.mode}-${user.id}`,
          }
        )

        customerId = customer.id
      }

      // There is no unique constraint on `user_id` because a user can have
      // several historical subscription rows keyed by stripe_subscription_id.
      // Update the most recent row, or insert a fresh customer mapping.
      const { data: mostRecentSub, error: recentSubError } = await admin
        .from('subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('stripe_mode', stripeConfig.mode)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recentSubError) {
        throw new Error(
          `Read local subscription failed: ${recentSubError.message}`
        )
      }

      const customerSaveError = mostRecentSub?.id
        ? (
            await admin
              .from('subscriptions')
              .update({ stripe_customer_id: customerId })
              .eq('id', mostRecentSub.id)
          ).error
        : (
            await admin.from('subscriptions').insert({
              user_id: user.id,
              stripe_customer_id: customerId,
              stripe_mode: stripeConfig.mode,
              status: 'inactive',
            })
          ).error

      if (customerSaveError) {
        throw new Error(
          `Save Stripe customer mapping failed: ${customerSaveError.message}`
        )
      }
    }

    if (customerId) {
      const remoteSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
      })
      const managedRemoteSubscription = remoteSubscriptions.data.find(
        (subscription) =>
          STRIPE_MANAGED_SUBSCRIPTION_STATUSES.includes(
            subscription.status as (typeof STRIPE_MANAGED_SUBSCRIPTION_STATUSES)[number]
          )
      )

      if (managedRemoteSubscription) {
        return NextResponse.json(
          {
            error:
              'A Stripe subscription already exists. Open billing management to change or repair it.',
          },
          { status: 409 }
        )
      }
    }

    let requestedExpiresAt = new Date(
      Date.now() + 60 * 60 * 1_000
    ).toISOString()
    let attempt = await claimCheckoutAttempt(
      admin,
      user.id,
      String(plan.id),
      requestedExpiresAt
    )

    if (!attempt.claimed) {
      if (
        (attempt.attemptStatus === 'open' ||
          attempt.attemptStatus === 'completed') &&
        attempt.sessionId
      ) {
        const existingSession = await stripe.checkout.sessions.retrieve(
          attempt.sessionId
        )

        if (
          attempt.attemptStatus === 'open' &&
          attempt.existingPlanId === String(plan.id) &&
          existingSession.status === 'open' &&
          existingSession.url
        ) {
          return NextResponse.json({ url: existingSession.url })
        }

        if (
          attempt.attemptStatus === 'open' &&
          existingSession.status === 'expired'
        ) {
          // The database never replaces an open row based on its local clock.
          // Reconcile the exact Stripe Session first, then claim a fresh token.
          const { error: expireError } = await admin.rpc(
            'expire_stripe_checkout_attempt',
            {
              p_user_id: user.id,
              p_stripe_mode: stripeConfig.mode,
              p_session_id: existingSession.id,
            }
          )

          if (expireError) {
            throw new Error(
              `Reconcile expired Stripe checkout failed: ${expireError.message}`
            )
          }

          requestedExpiresAt = new Date(
            Date.now() + 60 * 60 * 1_000
          ).toISOString()
          attempt = await claimCheckoutAttempt(
            admin,
            user.id,
            String(plan.id),
            requestedExpiresAt
          )
        } else if (existingSession.status === 'complete') {
          const completedSubscriptionId =
            getCheckoutSubscriptionId(existingSession)

          if (completedSubscriptionId) {
            // Re-read the exact Subscription immediately before retiring the
            // exact Session lock. A complete-but-unpaid delayed Checkout can
            // still activate asynchronously and must remain locked.
            const completedSubscription = await stripe.subscriptions.retrieve(
              completedSubscriptionId
            )
            const irreversiblyTerminal =
              completedSubscription.status === 'canceled' ||
              completedSubscription.status === 'incomplete_expired'

            if (irreversiblyTerminal) {
              const { data: retired, error: retireError } = await admin.rpc(
                'retire_terminal_stripe_checkout_attempt',
                {
                  p_user_id: user.id,
                  p_stripe_mode: stripeConfig.mode,
                  p_session_id: existingSession.id,
                }
              )

              if (retireError || retired !== true) {
                throw new Error(
                  `Retire terminal Stripe checkout failed: ${retireError?.message || 'no matching attempt'}`
                )
              }

              requestedExpiresAt = new Date(
                Date.now() + 60 * 60 * 1_000
              ).toISOString()
              attempt = await claimCheckoutAttempt(
                admin,
                user.id,
                String(plan.id),
                requestedExpiresAt
              )
            }
          }
        }
      }

      if (!attempt.claimed) {
        return NextResponse.json(
          {
            error:
              'A checkout is already in progress. Complete it or wait for it to expire before choosing another plan.',
          },
          {
            status: 409,
            headers: {
              'Retry-After': String(retryAfterSeconds(attempt.expiresAt)),
            },
          }
        )
      }
    }

    // Live mode requires the database attempt token. Test mode may temporarily
    // use a per-user server fingerprint while the lock migration is rolling out.
    const attemptToken = attempt.attemptToken || 'pre-migration-lock'
    const idempotencyKey = getCheckoutIdempotencyKey({
      userId: user.id,
      planId: String(plan.id),
      attemptToken,
    })

    const expiresAtUnix = attempt.expiresAt
      ? Math.floor(new Date(attempt.expiresAt).getTime() / 1_000)
      : null

    if (
      attempt.attemptToken &&
      (!expiresAtUnix || expiresAtUnix <= Math.floor(Date.now() / 1_000))
    ) {
      throw new Error('Stripe checkout attempt has an invalid expiry.')
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        integration_identifier: STRIPE_CHECKOUT_INTEGRATION_IDENTIFIER,

        ...(customerId ? { customer: customerId } : {}),

        line_items: [
          {
            price: stripePriceId,
            quantity: 1,
          },
        ],

        success_url: `${siteUrl}/pricing?success=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/pricing?canceled=1`,
        ...(expiresAtUnix ? { expires_at: expiresAtUnix } : {}),

        metadata: {
          user_id: user.id,
          plan_id: String(plan.id),
          stripe_mode: stripeConfig.mode,
        },

        subscription_data: {
          metadata: {
            user_id: user.id,
            plan_id: String(plan.id),
            stripe_mode: stripeConfig.mode,
          },
        },
      },
      {
        idempotencyKey,
      }
    )

    if (session.status !== 'open' || !session.url) {
      if (attempt.attemptToken) {
        await admin.rpc('fail_stripe_checkout_attempt', {
          p_user_id: user.id,
          p_stripe_mode: stripeConfig.mode,
          p_attempt_token: attempt.attemptToken,
        })
      }

      throw new Error('Stripe did not return an open Checkout Session.')
    }

    if (attempt.attemptToken) {
      const { data: opened, error: openError } = await admin.rpc(
        'open_stripe_checkout_attempt',
        {
          p_user_id: user.id,
          p_stripe_mode: stripeConfig.mode,
          p_attempt_token: attempt.attemptToken,
          p_session_id: session.id,
          p_expires_at: new Date(session.expires_at * 1_000).toISOString(),
        }
      )

      if (openError || opened !== true) {
        let expired = false

        try {
          await stripe.checkout.sessions.expire(session.id)
          expired = true
        } catch (expireError) {
          console.error(
            'Could not expire untracked Stripe Checkout Session:',
            expireError
          )
        }

        if (expired) {
          await admin.rpc('fail_stripe_checkout_attempt', {
            p_user_id: user.id,
            p_stripe_mode: stripeConfig.mode,
            p_attempt_token: attempt.attemptToken,
          })
        }

        throw new Error(
          `Open Stripe checkout attempt failed: ${openError?.message || 'attempt ownership changed'}`
        )
      }
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Stripe checkout error:', error)

    return NextResponse.json(
      {
        error: 'Unable to start checkout. Please try again.',
      },
      { status: 500 }
    )
  }
}
