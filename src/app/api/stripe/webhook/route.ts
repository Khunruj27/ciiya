import Stripe from 'stripe'
import { headers } from 'next/headers'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { stripe, stripeConfig } from '@/lib/stripe'
import {
  getStripePriceColumn,
  getStripeSiteUrl,
  getStripeWebhookConfigFingerprint,
  getStripeWebhookSecret,
  stripeModeFromLivemode,
  type StripeMode,
} from '@/lib/stripe-config'
import {
  getCheckoutSubscriptionId,
  getInvoiceSubscriptionId,
  isUuid,
} from '@/lib/stripe-billing'

export const runtime = 'nodejs'

type StripeSubscriptionWithPeriod = Stripe.Subscription & {
  current_period_start?: number | null
  current_period_end?: number | null
}

type SyncOptions = {
  updateEntitlement: boolean
  eventId: string
  eventCreatedAt: string
  paidPlanId?: string | null
  paidInvoiceId?: string | null
  paidPriceIds?: readonly string[]
}

type EntitlementReconciliationResult = {
  state_applied?: boolean
  entitlement_applied?: boolean
  effective_plan?: string | null
  effective_subscription_id?: string | null
  eligible_subscription_count?: number | string | null
}

type StripeWebhookOriginVerification = {
  configFingerprint: string
  stripeAccountId: string
  webhookEndpoint: string
  eventType:
    | 'checkout.session.completed'
    | 'checkout.session.async_payment_succeeded'
    | 'invoice.paid'
  eventCreatedAt: string
}

function getCurrentPeriod(subscription: StripeSubscriptionWithPeriod) {
  const item = subscription.items?.data?.[0]

  return {
    start: item?.current_period_start ?? subscription.current_period_start ?? null,
    end: item?.current_period_end ?? subscription.current_period_end ?? null,
  }
}

function getInvoiceSubscriptionPriceIds(
  invoice: Stripe.Invoice,
  subscriptionId: string
) {
  return invoice.lines.data.flatMap((line) => {
    const lineSubscriptionId =
      typeof line.subscription === 'string'
        ? line.subscription
        : line.subscription?.id

    if (lineSubscriptionId !== subscriptionId) return []

    const price = line.pricing?.price_details?.price
    const priceId = typeof price === 'string' ? price : price?.id

    return priceId ? [priceId] : []
  })
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

function throwOnDatabaseError(
  context: string,
  error: { message: string } | null
) {
  if (error) throw new Error(`${context}: ${error.message}`)
}

function isStripePaidOriginCandidate(event: Stripe.Event) {
  if (event.type === 'invoice.paid') return true

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data.object as Stripe.Checkout.Session
    return session.payment_status === 'paid'
  }

  return false
}

async function verifyLiveStripeEventOrigin(event: Stripe.Event) {
  if (
    stripeConfig.mode !== 'live' ||
    !(
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded' ||
      event.type === 'invoice.paid'
    )
  ) {
    return {
      event,
      originVerification: null as StripeWebhookOriginVerification | null,
    }
  }

  const expectedAccountId =
    process.env.STRIPE_EXPECTED_LIVE_ACCOUNT_ID?.trim() || ''
  const webhookSecret = getStripeWebhookSecret()
  const webhookEndpoint = `${getStripeSiteUrl()}/api/stripe/webhook`

  if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccountId)) {
    throw new Error('STRIPE_EXPECTED_LIVE_ACCOUNT_ID is missing or invalid.')
  }
  if (!webhookSecret) {
    throw new Error('Stripe Live webhook secret is unavailable.')
  }

  // Signature verification proves possession of the endpoint secret. Event
  // retrieval additionally proves this event ID belongs to the Stripe account
  // selected by the Live runtime key. Process the canonical object returned by
  // Stripe so a locally signed payload cannot substitute different event data.
  const [account, canonicalEvent] = await Promise.all([
    stripe.accounts.retrieve(null),
    stripe.events.retrieve(event.id),
  ])

  if (account.id !== expectedAccountId) {
    throw new Error('Stripe Live runtime account does not match the expected account.')
  }
  if (
    canonicalEvent.id !== event.id ||
    canonicalEvent.type !== event.type ||
    canonicalEvent.livemode !== true ||
    canonicalEvent.created !== event.created
  ) {
    throw new Error('Stripe API event does not match the signed webhook event.')
  }

  if (!isStripePaidOriginCandidate(canonicalEvent)) {
    return {
      event: canonicalEvent,
      originVerification: null as StripeWebhookOriginVerification | null,
    }
  }

  return {
    event: canonicalEvent,
    originVerification: {
      configFingerprint: getStripeWebhookConfigFingerprint(
        webhookSecret,
        webhookEndpoint,
        expectedAccountId
      ),
      stripeAccountId: expectedAccountId,
      webhookEndpoint,
      eventType: canonicalEvent.type,
      eventCreatedAt: new Date(canonicalEvent.created * 1_000).toISOString(),
    } satisfies StripeWebhookOriginVerification,
  }
}

async function claimWebhookEvent(
  supabase: SupabaseClient,
  event: Stripe.Event,
  mode: StripeMode
) {
  const { data, error } = await supabase.rpc('claim_stripe_webhook_event', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_livemode: mode === 'live',
  })

  if (error) {
    if (stripeConfig.mode === 'live') {
      throw new Error(`Claim Stripe webhook event failed: ${error.message}`)
    }

    console.warn(
      'Stripe webhook ledger unavailable in Test mode; processing without deduplication:',
      error.message
    )
    return {
      claimed: true,
      eventStatus: 'processing',
      attemptCount: null,
    }
  }

  const row = Array.isArray(data) ? data[0] : data

  return {
    claimed: Boolean(row?.claimed),
    eventStatus: String(row?.event_status || 'unknown'),
    attemptCount: Number(row?.attempt_count || 0) || null,
  }
}

async function markWebhookEvent(
  supabase: SupabaseClient,
  eventId: string,
  attemptCount: number | null,
  status: 'completed' | 'failed',
  errorMessage?: string,
  originVerification?: StripeWebhookOriginVerification | null
) {
  if (!attemptCount) return

  const rpc =
    status === 'completed'
      ? originVerification
        ? supabase.rpc(
            'complete_stripe_webhook_event_with_origin_verification',
            {
              p_event_id: eventId,
              p_attempt_count: attemptCount,
              p_config_fingerprint: originVerification.configFingerprint,
              p_stripe_account_id: originVerification.stripeAccountId,
              p_webhook_endpoint: originVerification.webhookEndpoint,
              p_event_type: originVerification.eventType,
              p_event_created_at: originVerification.eventCreatedAt,
            }
          )
        : supabase.rpc('complete_stripe_webhook_event', {
            p_event_id: eventId,
            p_attempt_count: attemptCount,
          })
      : supabase.rpc('fail_stripe_webhook_event', {
          p_event_id: eventId,
          p_attempt_count: attemptCount,
          p_error: errorMessage?.slice(0, 4_000) || 'Unknown webhook error',
        })
  const { data, error } = await rpc

  if ((error || data !== true) && stripeConfig.mode === 'live') {
    throw new Error(
      `Update Stripe webhook ledger failed: ${error?.message || 'attempt ownership changed'}`
    )
  }

  if (error || data !== true) {
    console.warn(
      'Stripe webhook ledger update skipped in Test mode:',
      error?.message || 'attempt ownership changed'
    )
  }
}

async function updateCheckoutAttempt(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session,
  mode: StripeMode,
  action: 'complete' | 'expire'
) {
  const userId = session.metadata?.user_id
  const metadataMode = session.metadata?.stripe_mode

  if (!isUuid(userId) || metadataMode !== mode) {
    throw new Error('Stripe Checkout Session has invalid Ciiya ownership metadata.')
  }

  const rpc =
    action === 'complete'
      ? 'complete_stripe_checkout_attempt'
      : 'expire_stripe_checkout_attempt'
  const { data, error } = await supabase.rpc(rpc, {
    p_user_id: userId,
    p_stripe_mode: mode,
    p_session_id: session.id,
  })

  if ((error || data !== true) && stripeConfig.mode === 'live') {
    // Expiry/failure events can arrive after a completed attempt was released
    // or after a newer attempt replaced the old Session. A clean no-match is
    // therefore an obsolete event, not a reason to retry the webhook forever.
    if (!error && action === 'expire') return false

    throw new Error(
      `Update Stripe checkout attempt failed: ${error?.message || 'no matching attempt'}`
    )
  }

  if (error || data !== true) {
    console.warn(
      'Stripe checkout attempt ledger unavailable in Test mode:',
      error?.message || 'no matching attempt'
    )
  }

  return error ? true : data === true
}

async function resolveSubscriptionUserId(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  mode: StripeMode
) {
  const { data: exact, error: exactError } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscription.id)
    .eq('stripe_mode', mode)
    .maybeSingle()

  throwOnDatabaseError('Read local Stripe subscription failed', exactError)
  if (exact?.user_id) return String(exact.user_id)

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id

  if (customerId) {
    const { data: byCustomer, error: customerError } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .eq('stripe_mode', mode)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    throwOnDatabaseError(
      'Read Stripe customer ownership failed',
      customerError
    )
    if (byCustomer?.user_id) return String(byCustomer.user_id)
  }

  const metadataUserId = subscription.metadata?.user_id
  return isUuid(metadataUserId) ? metadataUserId : null
}

async function reconcileSubscriptionSnapshot(
  subscription: StripeSubscriptionWithPeriod,
  mode: StripeMode,
  options: SyncOptions
) {
  const supabase = getAdminSupabase()
  const subscriptionMode = stripeModeFromLivemode(subscription.livemode)

  if (subscriptionMode !== mode || mode !== stripeConfig.mode) {
    throw new Error('Stripe subscription mode does not match this deployment.')
  }

  const priceId = subscription.items?.data?.[0]?.price?.id
  const latestInvoiceId =
    typeof subscription.latest_invoice === 'string'
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id
  const userId = await resolveSubscriptionUserId(supabase, subscription, mode)
  const stripeCustomerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id ?? null

  if (!userId) throw new Error('Stripe subscription has no verified Ciiya owner.')

  const period = getCurrentPeriod(subscription)
  const currentPeriodStartIso = period.start
    ? new Date(period.start * 1_000).toISOString()
    : null
  const currentPeriodEndIso = period.end
    ? new Date(period.end * 1_000).toISOString()
    : null

  let plan: { id: string } | null = null

  if (priceId) {
    const { data, error } = await supabase
      .from('plans')
      .select('id')
      .eq(getStripePriceColumn(mode), priceId)
      .maybeSingle()

    throwOnDatabaseError(`Plan not found for Stripe Price ${priceId}`, error)
    plan = data
  }

  if (
    !plan &&
    (subscription.status === 'active' ||
      subscription.status === 'trialing' ||
      subscription.status === 'past_due')
  ) {
    throw new Error(
      priceId
        ? `Plan not found for Stripe Price ${priceId}.`
        : 'Stripe subscription has no Price.'
    )
  }

  const paidEvidenceMatchesPlan = Boolean(
    options.updateEntitlement &&
      plan &&
      ((options.paidPlanId && options.paidPlanId === plan.id) ||
        (options.paidInvoiceId &&
          options.paidInvoiceId === latestInvoiceId &&
          priceId &&
          options.paidPriceIds?.includes(priceId)))
  )

  if (options.updateEntitlement && !paidEvidenceMatchesPlan) {
    // A paid event proves only the plan/Price embedded in that event. A
    // delayed invoice or Checkout Session must not grant a newer plan merely
    // because retrieving the Subscription now returns that newer Price.
    console.error('stripe_paid_entitlement_evidence_mismatch', {
      userId,
      mode,
      subscriptionId: subscription.id,
      currentPlanId: plan?.id ?? null,
      currentPriceId: priceId ?? null,
      paidPlanId: options.paidPlanId ?? null,
      latestInvoiceId: latestInvoiceId ?? null,
      paidInvoiceId: options.paidInvoiceId ?? null,
      paidPriceIds: options.paidPriceIds ?? [],
      eventId: options.eventId,
    })
  }

  const { data, error } = await supabase.rpc(
    'reconcile_stripe_subscription_entitlement',
    {
      p_user_id: userId,
      p_stripe_mode: mode,
      p_subscription_id: subscription.id,
      p_customer_id: stripeCustomerId,
      p_plan_id: plan?.id ?? null,
      p_status: subscription.status,
      p_current_period_start: currentPeriodStartIso,
      p_current_period_end: currentPeriodEndIso,
      p_cancel_at_period_end: subscription.cancel_at_period_end,
      p_event_created_at: options.eventCreatedAt,
      p_event_id: options.eventId,
      p_grant_entitlement: paidEvidenceMatchesPlan,
    }
  )

  throwOnDatabaseError('Reconcile Stripe entitlement failed', error)

  const result = (Array.isArray(data) ? data[0] : data) as
    | EntitlementReconciliationResult
    | null

  if (!result) {
    throw new Error('Reconcile Stripe entitlement returned no result.')
  }

  const eligibleCount = Number(result.eligible_subscription_count || 0)

  if (eligibleCount > 1) {
    // Keep the durable reconciliation result and surface the invariant breach
    // prominently. Retrying this webhook cannot repair duplicate Stripe
    // subscriptions; live preflight blocks cutover while duplicates exist.
    console.error('stripe_multiple_eligible_subscriptions', {
      userId,
      mode,
      subscriptionId: subscription.id,
      effectiveSubscriptionId: result.effective_subscription_id ?? null,
      eligibleSubscriptionCount: eligibleCount,
      eventId: options.eventId,
    })
  }

}

async function syncSubscription(
  stripeSubscriptionId: string,
  mode: StripeMode,
  options: SyncOptions
) {
  const subscription = (await stripe.subscriptions.retrieve(
    stripeSubscriptionId,
    { expand: ['items.data.price'] }
  )) as StripeSubscriptionWithPeriod

  await reconcileSubscriptionSnapshot(subscription, mode, options)
}

async function processStripeEvent(event: Stripe.Event, mode: StripeMode) {
  const eventContext = {
    eventId: event.id,
    eventCreatedAt: new Date(event.created * 1_000).toISOString(),
  }

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data.object as Stripe.Checkout.Session
    const subscriptionId = getCheckoutSubscriptionId(session)

    if (!subscriptionId) {
      throw new Error('Completed Stripe Checkout Session has no Subscription.')
    }

    const paymentSucceeded = session.payment_status !== 'unpaid'

    // Delayed payment methods emit checkout.session.completed while the
    // payment is still unpaid. Keep the attempt open until Stripe confirms
    // async success (or marks it failed/expired) so out-of-order delivery
    // cannot turn a failed attempt back into a completed one.
    if (paymentSucceeded) {
      await updateCheckoutAttempt(getAdminSupabase(), session, mode, 'complete')
    }

    // Complete the paid Session lock before syncing the Subscription. The
    // exact Session lock remains as the durable idempotency record; a future
    // Checkout may retire it only after re-reading this exact Subscription and
    // proving it is irreversibly terminal.
    await syncSubscription(subscriptionId, mode, {
      ...eventContext,
      updateEntitlement: paymentSucceeded,
      paidPlanId: paymentSucceeded ? session.metadata?.plan_id : null,
    })
    return paymentSucceeded
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object as Stripe.Checkout.Session
    const subscriptionId = getCheckoutSubscriptionId(session)
    const attemptUpdated = await updateCheckoutAttempt(
      getAdminSupabase(),
      session,
      mode,
      'expire'
    )

    if (!attemptUpdated) return false

    if (subscriptionId) {
      await syncSubscription(subscriptionId, mode, {
        ...eventContext,
        updateEntitlement: false,
      })
    }
    return false
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session
    await updateCheckoutAttempt(getAdminSupabase(), session, mode, 'expire')
    return false
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.paused' ||
    event.type === 'customer.subscription.resumed'
  ) {
    const subscription = event.data.object as StripeSubscriptionWithPeriod
    // Subscription events can arrive out of order and Stripe timestamps have
    // one-second precision. Re-read the canonical object so a stale
    // incomplete/paused payload cannot defeat a paid active snapshot that was
    // produced in the same second.
    await syncSubscription(subscription.id, mode, {
      ...eventContext,
      updateEntitlement: false,
    })
    return false
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    const subscriptionId = getInvoiceSubscriptionId(invoice)

    if (subscriptionId) {
      const paidPriceIds =
        event.type === 'invoice.paid'
          ? getInvoiceSubscriptionPriceIds(invoice, subscriptionId)
          : []

      await syncSubscription(subscriptionId, mode, {
        ...eventContext,
        updateEntitlement: event.type === 'invoice.paid',
        paidInvoiceId: event.type === 'invoice.paid' ? invoice.id : null,
        paidPriceIds,
      })
      return event.type === 'invoice.paid'
    }
    return false
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as StripeSubscriptionWithPeriod
    await reconcileSubscriptionSnapshot(subscription, mode, {
      ...eventContext,
      updateEntitlement: false,
    })
    return false
  }

  return false
}

export async function POST(req: Request) {
  const body = await req.text()
  const signature = (await headers()).get('stripe-signature')

  if (!signature) {
    return new Response('Missing stripe-signature', { status: 400 })
  }

  const webhookSecret = getStripeWebhookSecret()

  if (!webhookSecret) {
    console.error('Stripe webhook secret is not configured.')
    return new Response('Webhook unavailable', { status: 503 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (error) {
    console.warn(
      'Stripe webhook signature verification failed:',
      error instanceof Error ? error.message : 'Unknown error'
    )
    return new Response('Invalid webhook signature', { status: 400 })
  }

  const eventMode = stripeModeFromLivemode(event.livemode)

  if (eventMode !== stripeConfig.mode) {
    return new Response('Stripe event mode mismatch', { status: 400 })
  }

  const supabase = getAdminSupabase()
  let claimed = false
  let claimAttemptCount: number | null = null
  let claimedEventStatus = 'unknown'

  try {
    const claim = await claimWebhookEvent(supabase, event, eventMode)
    claimed = claim.claimed
    claimedEventStatus = claim.eventStatus
    claimAttemptCount = claim.attemptCount

    if (!claimed) {
      if (claimedEventStatus === 'completed') {
        return new Response('duplicate', { status: 200 })
      }

      // Do not acknowledge an in-flight/stuck delivery. Stripe will retry,
      // and the ledger can reclaim it once the stale window has elapsed.
      return new Response('Webhook event is already processing', {
        status: 503,
        headers: { 'Retry-After': '60' },
      })
    }

    const verifiedOrigin = await verifyLiveStripeEventOrigin(event)
    event = verifiedOrigin.event
    const processedPaidBillingEvent = await processStripeEvent(event, eventMode)
    await markWebhookEvent(
      supabase,
      event.id,
      claimAttemptCount,
      'completed',
      undefined,
      processedPaidBillingEvent ? verifiedOrigin.originVerification : null
    )
    return new Response('ok', { status: 200 })
  } catch (error) {
    console.error('Stripe webhook handler failed:', error)

    if (claimed) {
      try {
        await markWebhookEvent(
          supabase,
          event.id,
          claimAttemptCount,
          'failed',
          error instanceof Error ? error.message : 'Unknown error'
        )
      } catch (ledgerError) {
        console.error('Stripe webhook ledger failure:', ledgerError)
      }
    }

    return new Response('Webhook handler failed', { status: 500 })
  }
}
