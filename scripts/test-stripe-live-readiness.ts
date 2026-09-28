import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  getStripePriceId,
  getStripeRuntimeConfig,
  getStripeSiteUrl,
  getStripeWebhookConfigFingerprint,
  getStripeWebhookSecret,
  getStripeWebhookCanaryEventIdPrefix,
  getStripeLiveCheckoutRolloutMode,
  inferStripeKeyMode,
  inspectStripeEnvironment,
  isStripeCheckoutEnabled,
  isStripeLiveCheckoutOwnerAllowed,
} from '../src/lib/stripe-config'
import {
  getInvoiceSubscriptionId,
  STRIPE_MANAGED_SUBSCRIPTION_STATUSES,
} from '../src/lib/stripe-billing'

async function main() {
  assert.equal(inferStripeKeyMode('sk_test_example'), 'test')
  assert.equal(inferStripeKeyMode('rk_live_example'), 'live')
  assert.equal(inferStripeKeyMode('pk_live_example'), 'live')
  assert.equal(inferStripeKeyMode('whsec_example'), null)

  const testConfig = getStripeRuntimeConfig({
    STRIPE_MODE: 'test',
    STRIPE_LIVE_ENABLED: 'false',
    STRIPE_SECRET_KEY: 'sk_test_example',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
  })
  assert.equal(testConfig.mode, 'test')

  assert.throws(
    () =>
      getStripeRuntimeConfig({
        STRIPE_MODE: 'test',
        STRIPE_LIVE_ENABLED: 'false',
        STRIPE_SECRET_KEY: 'rk_live_example',
      }),
    /does not match/
  )
  assert.throws(
    () =>
      getStripeRuntimeConfig({
        STRIPE_MODE: 'live',
        STRIPE_LIVE_ENABLED: 'false',
        STRIPE_SECRET_KEY: 'rk_live_example',
      }),
    /locked/
  )

  const liveConfig = getStripeRuntimeConfig({
    STRIPE_MODE: 'live',
    STRIPE_LIVE_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'rk_live_example',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_example',
  })
  assert.equal(liveConfig.mode, 'live')

  const stagedLiveConfig = getStripeRuntimeConfig({
    STRIPE_MODE: 'live',
    STRIPE_LIVE_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_rollback',
    STRIPE_LIVE_RUNTIME_SECRET_KEY: 'rk_live_staged',
    STRIPE_LIVE_PUBLISHABLE_KEY: 'pk_live_staged',
  })
  assert.equal(stagedLiveConfig.secretKey, 'rk_live_staged')

  const missingPublishable = inspectStripeEnvironment(
    {
      STRIPE_MODE: 'live',
      STRIPE_LIVE_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'rk_live_example',
    },
    { requirePublishableKey: true }
  )
  assert.match(
    missingPublishable.errors.join(' '),
    /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required/
  )

  assert.equal(
    getStripeWebhookSecret({
      STRIPE_MODE: 'live',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live',
    }),
    'whsec_live'
  )
  assert.equal(
    getStripeWebhookSecret({
      STRIPE_MODE: 'live',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_must_not_fallback',
    }),
    null
  )
  assert.equal(
    getStripeSiteUrl({
      NODE_ENV: 'development',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000/pricing',
    }),
    'http://localhost:3000'
  )
  assert.throws(
    () =>
      getStripeSiteUrl({
        NODE_ENV: 'production',
        NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      }),
    /public HTTPS URL/
  )

  const mismatch = inspectStripeEnvironment({
    STRIPE_MODE: 'live',
    STRIPE_LIVE_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'rk_live_example',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
  })
  assert.equal(mismatch.errors.length, 1)

  const plan = {
    stripe_price_id: 'price_test',
    stripe_live_price_id: 'price_live',
  }
  assert.equal(getStripePriceId(plan, 'test'), 'price_test')
  assert.equal(getStripePriceId(plan, 'live'), 'price_live')
  assert.equal(getStripePriceId({ stripe_price_id: 'price_test' }, 'live'), null)
  assert.equal(isStripeCheckoutEnabled({}), true)
  assert.equal(
    isStripeCheckoutEnabled({ STRIPE_MODE: 'live' }),
    false
  )
  assert.equal(
    isStripeCheckoutEnabled({
      STRIPE_MODE: 'live',
      STRIPE_CHECKOUT_ENABLED: 'true',
    }),
    false
  )
  assert.equal(
    isStripeCheckoutEnabled({
      STRIPE_MODE: 'live',
      STRIPE_CHECKOUT_ENABLED: 'true',
      STRIPE_LIVE_WEBHOOK_SECRET: `whsec_${'a'.repeat(24)}`,
    }),
    true
  )
  assert.equal(isStripeCheckoutEnabled({ STRIPE_CHECKOUT_ENABLED: 'false' }), false)
  const canaryOwner = '8c3bc3e5-7258-43c6-bb32-8ead49c1d8e8'
  assert.equal(getStripeLiveCheckoutRolloutMode({}), 'off')
  assert.equal(
    isStripeLiveCheckoutOwnerAllowed(canaryOwner, {
      STRIPE_LIVE_CHECKOUT_ROLLOUT_MODE: 'canary',
      STRIPE_LIVE_CHECKOUT_CANARY_OWNER_IDS: canaryOwner,
    }),
    true
  )
  assert.equal(
    isStripeLiveCheckoutOwnerAllowed(canaryOwner, {
      STRIPE_LIVE_CHECKOUT_ROLLOUT_MODE: 'canary',
      STRIPE_LIVE_CHECKOUT_CANARY_OWNER_IDS: '8',
    }),
    false
  )
  assert.equal(
    isStripeLiveCheckoutOwnerAllowed(canaryOwner, {
      STRIPE_LIVE_CHECKOUT_ROLLOUT_MODE: 'all',
    }),
    true
  )

  const expectedLiveAccountId = 'acct_ciiya123'
  const canaryPrefix = getStripeWebhookCanaryEventIdPrefix(
    `whsec_${'a'.repeat(24)}`,
    'https://ciiya.vercel.app/api/stripe/webhook?ignored=true',
    expectedLiveAccountId
  )
  assert.match(canaryPrefix, /^evt_ciiya_canary_[a-f0-9]{24}_$/)
  assert.equal(
    canaryPrefix,
    getStripeWebhookCanaryEventIdPrefix(
      `whsec_${'a'.repeat(24)}`,
      'https://ciiya.vercel.app/api/stripe/webhook/',
      expectedLiveAccountId
    )
  )
  assert.notEqual(
    canaryPrefix,
    getStripeWebhookCanaryEventIdPrefix(
      `whsec_${'b'.repeat(24)}`,
      'https://ciiya.vercel.app/api/stripe/webhook',
      expectedLiveAccountId
    )
  )
  const webhookFingerprint = getStripeWebhookConfigFingerprint(
    `whsec_${'a'.repeat(24)}`,
    'https://ciiya.vercel.app/api/stripe/webhook',
    expectedLiveAccountId
  )
  assert.match(webhookFingerprint, /^[a-f0-9]{64}$/)
  assert.notEqual(
    webhookFingerprint,
    getStripeWebhookConfigFingerprint(
      `whsec_${'a'.repeat(24)}`,
      'https://ciiya.vercel.app/api/stripe/webhook',
      'acct_other123'
    )
  )
  assert.throws(
    () =>
      getStripeWebhookConfigFingerprint(
        `whsec_${'a'.repeat(24)}`,
        'https://ciiya.vercel.app/api/stripe/webhook',
        ''
      ),
    /account ID/
  )

  assert.ok(STRIPE_MANAGED_SUBSCRIPTION_STATUSES.includes('past_due'))
  assert.equal(
    getInvoiceSubscriptionId({ subscription: 'sub_legacy' } as never),
    'sub_legacy'
  )
  assert.equal(
    getInvoiceSubscriptionId({
      parent: {
        subscription_details: { subscription: 'sub_modern' },
      },
    } as never),
    'sub_modern'
  )

  const webhook = await readFile(
    new URL('../src/app/api/stripe/webhook/route.ts', import.meta.url),
    'utf8'
  )
  for (const event of [
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
    'invoice.paid',
    'invoice.payment_failed',
    'customer.subscription.paused',
    'customer.subscription.resumed',
  ]) {
    assert.match(webhook, new RegExp(event.replaceAll('.', '\\.')))
  }
  assert.match(webhook, /constructEvent/)
  assert.match(webhook, /stripeModeFromLivemode/)
  assert.match(webhook, /claim_stripe_webhook_event/)
  assert.match(webhook, /complete_stripe_webhook_event/)
  assert.match(
    webhook,
    /complete_stripe_webhook_event_with_origin_verification/
  )
  assert.match(webhook, /fail_stripe_webhook_event/)
  assert.match(webhook, /claimedEventStatus === 'completed'/)
  assert.match(webhook, /Webhook event is already processing/)
  assert.match(webhook, /reconcile_stripe_subscription_entitlement/)
  assert.match(webhook, /p_event_created_at: options\.eventCreatedAt/)
  assert.match(webhook, /p_event_id: options\.eventId/)
  assert.match(webhook, /stripe_multiple_eligible_subscriptions/)
  assert.match(webhook, /complete_stripe_checkout_attempt/)
  assert.match(webhook, /expire_stripe_checkout_attempt/)
  assert.doesNotMatch(webhook, /release_completed_stripe_checkout_attempt/)
  assert.match(
    webhook,
    /event\.type === 'customer\.subscription\.created'[\s\S]*?await syncSubscription\(subscription\.id, mode, \{[\s\S]*?updateEntitlement: false/
  )
  assert.match(webhook, /updateEntitlement: event\.type === 'invoice\.paid'/)
  assert.match(webhook, /getInvoiceSubscriptionPriceIds/)
  assert.match(
    webhook,
    /paidPlanId: paymentSucceeded \? session\.metadata\?\.plan_id : null/
  )
  assert.match(
    webhook,
    /p_grant_entitlement: paidEvidenceMatchesPlan/
  )
  assert.match(webhook, /options\.paidPlanId === plan\.id/)
  assert.match(webhook, /options\.paidInvoiceId === latestInvoiceId/)
  assert.match(webhook, /options\.paidPriceIds\?\.includes\(priceId\)/)
  assert.match(
    webhook,
    /paidInvoiceId: event\.type === 'invoice\.paid' \? invoice\.id : null/
  )
  assert.doesNotMatch(
    webhook,
    /p_grant_entitlement: options\.updateEntitlement/
  )
  assert.match(webhook, /stripe_paid_entitlement_evidence_mismatch/)
  assert.match(webhook, /stripe\.events\.retrieve\(event\.id\)/)
  assert.match(webhook, /stripe\.accounts\.retrieve\(null\)/)
  assert.match(webhook, /canonicalEvent\.livemode !== true/)
  assert.match(webhook, /getStripeWebhookConfigFingerprint/)
  assert.match(webhook, /processedPaidBillingEvent/)
  assert.match(webhook, /STRIPE_EXPECTED_LIVE_ACCOUNT_ID/)
  assert.doesNotMatch(webhook, /\.from\(['"]user_storage_usage['"]\)/)
  assert.doesNotMatch(webhook, /error instanceof Error \? error\.message : 'Webhook/)

  const preflight = await readFile(
    new URL('./stripe-live-preflight.ts', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(
    preflight,
    /stripe\.(?:customers|prices|products|webhookEndpoints|subscriptions)\.(?:create|update|del)\s*\(/
  )
  assert.match(preflight, /No writes performed/)
  assert.match(preflight, /billingPortal\.configurations\.list/)
  assert.match(preflight, /data\.features\.subscription_update\.products/)
  assert.match(preflight, /Runtime account consistency/)
  assert.match(preflight, /Runtime Stripe account/)
  assert.match(preflight, /runtimeStripe\.accounts\.retrieve\(null\)/)
  assert.match(preflight, /runtimeStripe\.prices\.retrieve/)
  assert.match(preflight, /item\.is_default/)
  assert.match(preflight, /catalogMatches/)
  assert.match(preflight, /quantitiesLocked/)
  assert.match(preflight, /immediateChanges/)
  assert.match(preflight, /payouts_enabled/)
  assert.match(preflight, /Paid storage entitlements/)
  assert.match(preflight, /const entitledLiveRows = eligibleLiveRows\.filter/)
  assert.match(
    preflight,
    /subscription\.status !== 'past_due'[\s\S]*?subscription\.entitlement_plan_id !== subscription\.plan_id/
  )
  assert.match(preflight, /Concurrent Live subscriptions/)
  assert.match(preflight, /multiple managed Live subscriptions/)
  assert.match(preflight, /ciiya\.webhook_canary/)
  assert.match(preflight, /proration_behavior === 'always_invoice'/)
  assert.match(preflight, /EXPECTED_STORAGE_LIMITS/)

  const canary = await readFile(
    new URL('./stripe-webhook-canary.ts', import.meta.url),
    'utf8'
  )
  assert.match(canary, /STRIPE_WEBHOOK_CANARY_APPLY_ENABLED/)
  assert.match(canary, /ciiya\.webhook_canary/)
  assert.match(canary, /generateTestHeaderString/)
  assert.doesNotMatch(canary, /console\.log\([^)]*(?:secret|runtimeKey)/)

  for (const retiredRoute of [
    '../src/app/api/billing/change-plan/route.ts',
    '../src/app/albums/[id]/change-plan/route.ts',
    '../src/app/api/stripe/change-plan/route.ts',
    '../src/app/api/stripe/downgrade/route.ts',
    '../src/app/api/stripe/portal/route.ts',
  ]) {
    const source = await readFile(new URL(retiredRoute, import.meta.url), 'utf8')
    assert.match(source, /status: 410/)
    assert.doesNotMatch(source, /user_storage_usage|\.from\(['"]subscriptions/)
  }

  const checkout = await readFile(
    new URL('../src/app/api/stripe/checkout/route.ts', import.meta.url),
    'utf8'
  )
  assert.match(checkout, /getAdminSupabase/)
  assert.match(checkout, /STRIPE_MANAGED_SUBSCRIPTION_STATUSES/)
  assert.match(checkout, /createHash\('sha256'\)/)
  assert.match(checkout, /getCheckoutIdempotencyKey/)
  assert.match(checkout, /remoteSubscriptions/)
  assert.match(checkout, /isStripeCheckoutEnabled/)
  assert.match(checkout, /event_type', 'ciiya\.webhook_canary'/)
  assert.match(checkout, /\.gte\('completed_at', webhookCanaryCutoff\)/)
  assert.match(checkout, /webhookCanaryEventIdPrefix/)
  assert.match(checkout, /getStripeLiveCheckoutRolloutMode/)
  assert.match(checkout, /rolloutMode === 'all'/)
  assert.match(checkout, /stripe_webhook_origin_verifications/)
  assert.match(checkout, /getStripeWebhookConfigFingerprint/)
  assert.match(checkout, /Verify Stripe-origin billing event failed/)
  assert.match(checkout, /existingSession\.status === 'complete'/)
  assert.match(
    checkout,
    /attempt\.attemptStatus === 'open' \|\|[\s\S]*?attempt\.attemptStatus === 'completed'/
  )
  assert.match(checkout, /retire_terminal_stripe_checkout_attempt/)
  assert.match(checkout, /getCheckoutSubscriptionId\(existingSession\)/)
  assert.match(checkout, /stripe\.subscriptions\.retrieve/)
  assert.match(checkout, /completedSubscription\.status === 'canceled'/)
  assert.match(checkout, /completedSubscription\.status === 'incomplete_expired'/)
  assert.match(checkout, /p_session_id: existingSession\.id/)
  assert.doesNotMatch(checkout, /Reconcile completed Stripe checkout failed/)
  assert.match(checkout, /livemode', true/)
  assert.match(checkout, /status', 'completed'/)
  assert.match(checkout, /p_expires_at: requestedExpiresAt/)
  assert.match(checkout, /p_expires_at: new Date\(session\.expires_at/)
  assert.match(checkout, /existingSession\.status === 'expired'/)
  assert.match(checkout, /planId: String\(plan\.id\)/)
  assert.match(checkout, /attemptToken,/)
  assert.doesNotMatch(checkout, /subscriptionId:\s*latestSubscription/)
  assert.doesNotMatch(checkout, /subscriptionStatus:\s*latestSubscription/)
  assert.doesNotMatch(checkout, /x-ciiya-idempotency-key/i)
  assert.doesNotMatch(checkout, /error instanceof Error \? error\.message/)

  assert.match(webhook, /const paymentSucceeded = session\.payment_status !== 'unpaid'/)
  assert.match(
    webhook,
    /if \(paymentSucceeded\) \{[\s\S]*?await updateCheckoutAttempt\([\s\S]*?'complete'\)[\s\S]*?\}\s*[\s\S]*?await syncSubscription\(subscriptionId/
  )
  assert.match(
    webhook,
    /if \(!error && action === 'expire'\) return false/,
    'obsolete Checkout expiry events must be acknowledged without retries'
  )
  assert.match(
    webhook,
    /checkout\.session\.async_payment_failed[\s\S]*?const attemptUpdated = await updateCheckoutAttempt[\s\S]*?if \(!attemptUpdated\) return[\s\S]*?await syncSubscription/,
    'obsolete asynchronous failure events must not resynchronize a newer attempt'
  )

  const ledgerCleanup = await readFile(
    new URL('./cleanup-stripe-webhook-events.ts', import.meta.url),
    'utf8'
  )
  assert.match(ledgerCleanup, /RETENTION_DAYS \|\| 90/)
  assert.match(ledgerCleanup, /CLEANUP_APPLY_ENABLED/)
  assert.match(ledgerCleanup, /\.eq\('status', 'completed'\)/)
  assert.doesNotMatch(ledgerCleanup, /\.eq\('status', 'failed'\)/)

  console.log('Stripe live-readiness checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
