import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import {
  getStripeWebhookConfigFingerprint,
  getStripeWebhookCanaryEventIdPrefix,
  inferStripeKeyMode,
  inspectStripeEnvironment,
} from '../src/lib/stripe-config'
import { STRIPE_MANAGED_SUBSCRIPTION_STATUSES } from '../src/lib/stripe-billing'

loadEnvConfig(process.cwd())

type CheckStatus = 'pass' | 'warn' | 'fail'
type Check = {
  name: string
  status: CheckStatus
  detail: string
}

const REQUIRED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const

const EXPECTED_PAID_PLANS = new Map([
  ['starter', 299],
  ['pro', 499],
  ['business', 699],
])

const EXPECTED_STORAGE_LIMITS = new Map([
  ['free', 5 * 1024 ** 3],
  ['starter', 20 * 1024 ** 3],
  ['pro', 50 * 1024 ** 3],
  ['business', 100 * 1024 ** 3],
])

function add(
  checks: Check[],
  status: CheckStatus,
  name: string,
  detail: string
) {
  checks.push({ status, name, detail })
}

function printChecks(checks: Check[]) {
  const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' } as const
  for (const check of checks) {
    console.log(`[${icon[check.status]}] ${check.name}: ${check.detail}`)
  }
}

async function main() {
  const checks: Check[] = []
  const secretKey = process.env.STRIPE_PREFLIGHT_SECRET_KEY?.trim()
  const runtimeSecretKey = process.env.STRIPE_LIVE_RUNTIME_SECRET_KEY?.trim()
  const publishableKey =
    process.env.STRIPE_PREFLIGHT_PUBLISHABLE_KEY?.trim() ||
    process.env.STRIPE_LIVE_PUBLISHABLE_KEY?.trim()
  const webhookSecret =
    process.env.STRIPE_PREFLIGHT_WEBHOOK_SECRET?.trim() ||
    process.env.STRIPE_LIVE_WEBHOOK_SECRET?.trim()
  const webhookUrl =
    process.env.STRIPE_PREFLIGHT_WEBHOOK_URL?.trim() ||
    'https://ciiya.vercel.app/api/stripe/webhook'
  const expectedLiveAccountId =
    process.env.STRIPE_EXPECTED_LIVE_ACCOUNT_ID?.trim() || ''
  const expectedSupabaseRef =
    process.env.STRIPE_EXPECTED_PRODUCTION_SUPABASE_REF?.trim() || ''
  const productionSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || ''
  let expectedWebhookUrl = ''
  let webhookUrlIsPinned = false

  try {
    const site = new URL(productionSiteUrl)
    const configuredWebhook = new URL(webhookUrl)
    expectedWebhookUrl = `${site.origin}/api/stripe/webhook`
    webhookUrlIsPinned =
      site.protocol === 'https:' &&
      configuredWebhook.protocol === 'https:' &&
      configuredWebhook.search === '' &&
      configuredWebhook.hash === '' &&
      configuredWebhook.href.replace(/\/$/, '') === expectedWebhookUrl
  } catch {
    // Reported as a structured preflight failure below.
  }

  add(
    checks,
    webhookUrlIsPinned ? 'pass' : 'fail',
    'Production webhook URL',
    webhookUrlIsPinned
      ? `Webhook URL is pinned to ${expectedWebhookUrl}.`
      : 'STRIPE_PREFLIGHT_WEBHOOK_URL must equal ${NEXT_PUBLIC_SITE_URL}/api/stripe/webhook using public HTTPS.'
  )

  let webhookCanaryEventIdPrefix: string | null = null
  let webhookConfigFingerprint: string | null = null
  try {
    if (
      webhookSecret &&
      webhookUrlIsPinned &&
      /^acct_[A-Za-z0-9]+$/.test(expectedLiveAccountId)
    ) {
      webhookConfigFingerprint = getStripeWebhookConfigFingerprint(
        webhookSecret,
        webhookUrl,
        expectedLiveAccountId
      )
      webhookCanaryEventIdPrefix = getStripeWebhookCanaryEventIdPrefix(
        webhookSecret,
        webhookUrl,
        expectedLiveAccountId
      )
    }
  } catch {
    // Invalid secret/URL is reported by the dedicated checks.
  }

  const inspection = inspectStripeEnvironment(
    {
      STRIPE_MODE: 'live',
      STRIPE_LIVE_ENABLED: 'true',
      STRIPE_SECRET_KEY: secretKey,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: publishableKey,
    },
    { requirePublishableKey: true }
  )

  if (inspection.errors.length > 0) {
    for (const error of inspection.errors) {
      add(checks, 'fail', 'Live credentials', error)
    }
  } else {
    add(
      checks,
      'pass',
      'Live credentials',
      'Secret/restricted key and publishable key are both live-mode keys.'
    )
  }

  if (/^whsec_[A-Za-z0-9_-]{20,}$/.test(webhookSecret || '')) {
    add(
      checks,
      'warn',
      'Webhook secret',
      'A live-format signing secret is staged. Run the internal canary for route/signature/ledger smoke, then require a Stripe-origin event before global rollout.'
    )
  } else {
    add(
      checks,
      'fail',
      'Webhook secret',
      'Set STRIPE_PREFLIGHT_WEBHOOK_SECRET to the live endpoint signing secret.'
    )
  }

  if (!secretKey || inferStripeKeyMode(secretKey) !== 'live') {
    printChecks(checks)
    process.exitCode = 1
    return
  }

  if (!runtimeSecretKey || inferStripeKeyMode(runtimeSecretKey) !== 'live') {
    add(
      checks,
      'fail',
      'Runtime Live credentials',
      'Set STRIPE_LIVE_RUNTIME_SECRET_KEY to the staged live runtime key so account/catalog consistency can be verified.'
    )
    printChecks(checks)
    process.exitCode = 1
    return
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!supabaseUrl || !serviceRoleKey) {
    add(
      checks,
      'fail',
      'Supabase read access',
      'Production Supabase URL and service-role key are required for plan validation.'
    )
    printChecks(checks)
    process.exitCode = 1
    return
  }

  let actualSupabaseRef = ''
  try {
    actualSupabaseRef = new URL(supabaseUrl).hostname.split('.')[0] || ''
  } catch {
    // The failed target-pin check below reports an invalid/mismatched URL.
  }
  const supabaseTargetPinned =
    /^[a-z0-9]{20}$/.test(expectedSupabaseRef) &&
    actualSupabaseRef === expectedSupabaseRef
  add(
    checks,
    supabaseTargetPinned ? 'pass' : 'fail',
    'Production Supabase target',
    supabaseTargetPinned
      ? `Preflight is pinned to Production project ${expectedSupabaseRef}.`
      : 'Set STRIPE_EXPECTED_PRODUCTION_SUPABASE_REF to the Production project ref and ensure NEXT_PUBLIC_SUPABASE_URL matches it.'
  )

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const stripe = new Stripe(secretKey)
  const runtimeStripe = new Stripe(runtimeSecretKey)

  const [
    accountResult,
    runtimeAccountResult,
    plansResult,
    webhookResult,
    portalResult,
    activeTestResult,
    paidUsageResult,
    activeLiveResult,
    managedLiveResult,
    pendingDowngradeResult,
    webhookCanaryResult,
    webhookOriginResult,
  ] =
    await Promise.allSettled([
      stripe.accounts.retrieve(null),
      runtimeStripe.accounts.retrieve(null),
      supabase
        .from('plans')
        .select(
          'id, slug, name, price_thb, storage_limit_bytes, is_active, stripe_price_id, stripe_live_price_id'
        )
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      stripe.webhookEndpoints.list({ limit: 100 }),
      stripe.billingPortal.configurations.list({
        active: true,
        limit: 100,
        expand: ['data.features.subscription_update.products'],
      }),
      supabase
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('stripe_mode', 'test')
        .in('status', [...STRIPE_MANAGED_SUBSCRIPTION_STATUSES]),
      supabase
        .from('user_storage_usage')
        .select('user_id, current_plan, storage_limit_bytes')
        .in('current_plan', ['starter', 'pro', 'business']),
      supabase
        .from('subscriptions')
        .select(
          'user_id, plan_id, entitlement_plan_id, stripe_subscription_id, status'
        )
        .eq('stripe_mode', 'live')
        .in('status', ['active', 'trialing', 'past_due']),
      supabase
        .from('subscriptions')
        .select('user_id, stripe_subscription_id')
        .eq('stripe_mode', 'live')
        .in('status', [...STRIPE_MANAGED_SUBSCRIPTION_STATUSES]),
      supabase
        .from('user_storage_usage')
        .select('user_id', { count: 'exact', head: true })
        .not('pending_plan', 'is', null),
      supabase
        .from('stripe_webhook_events')
        .select('event_id', { count: 'exact', head: true })
        .eq('event_type', 'ciiya.webhook_canary')
        .eq('livemode', true)
        .eq('status', 'completed')
        .like(
          'event_id',
          `${webhookCanaryEventIdPrefix || 'missing-webhook-secret'}%`
        )
        .gte(
          'completed_at',
          new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()
        ),
      supabase
        .from('stripe_webhook_origin_verifications')
        .select(
          'config_fingerprint, stripe_account_id, webhook_endpoint, event_id, event_type, event_created_at, verified_at'
        )
        .eq(
          'config_fingerprint',
          webhookConfigFingerprint || 'missing-webhook-config-fingerprint'
        )
        .eq('stripe_account_id', expectedLiveAccountId || 'missing-account')
        .eq('webhook_endpoint', expectedWebhookUrl || webhookUrl)
        .maybeSingle(),
    ])

  if (accountResult.status === 'fulfilled') {
    const account = accountResult.value
    const currentlyDue = account.requirements?.currently_due || []
    const pastDue = account.requirements?.past_due || []
    const ready =
      /^acct_[A-Za-z0-9]+$/.test(expectedLiveAccountId) &&
      account.id === expectedLiveAccountId &&
      account.details_submitted &&
      account.charges_enabled &&
      account.payouts_enabled &&
      currentlyDue.length === 0 &&
      pastDue.length === 0
    add(
      checks,
      ready ? 'pass' : 'fail',
      'Stripe account',
      ready
        ? `Expected account ${account.id} can accept live charges and payouts.`
        : `Account identity/readiness failed: expected=${expectedLiveAccountId || 'unset'}, actual=${account.id}, charges=${Boolean(account.charges_enabled)}, payouts=${Boolean(account.payouts_enabled)}, currently_due=${currentlyDue.length}, past_due=${pastDue.length}.`
    )
  } else {
    add(
      checks,
      'fail',
      'Stripe account',
      'The live key cannot read account readiness. Check restricted-key permissions.'
    )
  }

  if (runtimeAccountResult.status === 'fulfilled') {
    const runtimeAccount = runtimeAccountResult.value
    const matchesExpectedAccount =
      /^acct_[A-Za-z0-9]+$/.test(expectedLiveAccountId) &&
      runtimeAccount.id === expectedLiveAccountId

    add(
      checks,
      matchesExpectedAccount ? 'pass' : 'fail',
      'Runtime Stripe account',
      matchesExpectedAccount
        ? `The staged runtime key is pinned to expected account ${runtimeAccount.id}.`
        : `The staged runtime key belongs to ${runtimeAccount.id}; expected ${expectedLiveAccountId || 'unset'}.`
    )
  } else {
    add(
      checks,
      'fail',
      'Runtime Stripe account',
      'The staged runtime key cannot read its Stripe account. Add Account read permission and retry.'
    )
  }

  let plans: Array<{
    id: string
    slug: string
    name: string
    price_thb: number
    storage_limit_bytes: number
    stripe_live_price_id: string | null
  }> = []

  if (plansResult.status === 'fulfilled' && !plansResult.value.error) {
    plans = (plansResult.value.data || []) as typeof plans
    add(
      checks,
      'pass',
      'Plan schema',
      `Read ${plans.length} active plan(s), including live Price mappings.`
    )
  } else {
    add(
      checks,
      'fail',
      'Plan schema',
      'Cannot read stripe_live_price_id. Apply migration 202609270001 first.'
    )
  }

  const paidPlans = plans.filter((plan) => Number(plan.price_thb) > 0)
  const products = new Set<string>()

  const exactPlanCatalog =
    plans.length === EXPECTED_STORAGE_LIMITS.size &&
    plans.every((plan) => EXPECTED_STORAGE_LIMITS.has(plan.slug))
  add(
    checks,
    exactPlanCatalog ? 'pass' : 'fail',
    'Active plan catalog',
    exactPlanCatalog
      ? 'The active catalog contains exactly Free, Starter, Pro, and Business.'
      : 'The active catalog must contain exactly Free, Starter, Pro, and Business before cutover.'
  )

  for (const [slug, expectedBytes] of EXPECTED_STORAGE_LIMITS) {
    const plan = plans.find((item) => item.slug === slug)
    const valid = plan && Number(plan.storage_limit_bytes) === expectedBytes
    add(
      checks,
      valid ? 'pass' : 'fail',
      `Storage quota ${slug}`,
      valid
        ? `${slug} uses the expected ${expectedBytes / 1024 ** 3} GB quota.`
        : `${slug} must use exactly ${expectedBytes / 1024 ** 3} GB.`
    )
  }

  const freePlan = plans.find((plan) => plan.slug === 'free')
  add(
    checks,
    freePlan && Number(freePlan.price_thb) === 0 ? 'pass' : 'fail',
    'Catalog free',
    freePlan && Number(freePlan.price_thb) === 0
      ? 'Free plan amount is exactly 0 THB.'
      : 'Free plan must exist and cost exactly 0 THB.'
  )

  for (const [slug, expectedPrice] of EXPECTED_PAID_PLANS) {
    const plan = paidPlans.find((item) => item.slug === slug)
    add(
      checks,
      plan && Number(plan.price_thb) === expectedPrice ? 'pass' : 'fail',
      `Catalog ${slug}`,
      plan
        ? `Database amount is ${plan.price_thb} THB; expected ${expectedPrice} THB.`
        : `Missing active ${slug} plan.`
    )
  }

  for (const plan of paidPlans) {
    if (!plan.stripe_live_price_id) {
      add(
        checks,
        'fail',
        `Plan ${plan.slug}`,
        'Missing stripe_live_price_id.'
      )
      continue
    }

    try {
      const price = await stripe.prices.retrieve(plan.stripe_live_price_id, {
        expand: ['product'],
      })
      const product =
        typeof price.product === 'string' ? null : price.product
      const productIsActive = Boolean(
        product && 'active' in product && product.active
      )
      const expectedAmount = Math.round(Number(plan.price_thb) * 100)
      const valid =
        price.livemode &&
        price.active &&
        price.currency.toLowerCase() === 'thb' &&
        price.unit_amount === expectedAmount &&
        price.recurring?.interval === 'month' &&
        price.recurring?.interval_count === 1 &&
        price.recurring?.usage_type === 'licensed' &&
        price.billing_scheme === 'per_unit' &&
        productIsActive

      if (typeof price.product === 'string') products.add(price.product)
      else if (price.product?.id) products.add(price.product.id)

      add(
        checks,
        valid ? 'pass' : 'fail',
        `Plan ${plan.slug}`,
        valid
          ? `Live THB monthly Price matches ${plan.price_thb} THB.`
          : 'Live Price must be active, monthly with interval_count=1, licensed/per-unit, THB, match the database amount, and use an active Product.'
      )
    } catch {
      add(
        checks,
        'fail',
        `Plan ${plan.slug}`,
        'Live Price could not be retrieved. Check the ID and key permissions.'
      )
    }
  }

  const runtimeCatalogChecks = await Promise.allSettled(
    paidPlans
      .filter((plan) => Boolean(plan.stripe_live_price_id))
      .map((plan) => runtimeStripe.prices.retrieve(plan.stripe_live_price_id!))
  )
  const runtimeCatalogMatches =
    runtimeCatalogChecks.length === EXPECTED_PAID_PLANS.size &&
    runtimeCatalogChecks.every(
      (result) => result.status === 'fulfilled' && result.value.livemode
    )

  add(
    checks,
    runtimeCatalogMatches ? 'pass' : 'fail',
    'Runtime account consistency',
    runtimeCatalogMatches
      ? 'The staged runtime key can retrieve every verified Live Price from the audited Stripe account.'
      : 'The staged runtime key cannot retrieve the full audited Live catalog. Check key permissions and Stripe account ownership.'
  )

  if (paidPlans.length > 1 && products.size !== paidPlans.length) {
    add(
      checks,
      'fail',
      'Product catalog',
      'Each paid plan must use a separate Stripe Product.'
    )
  } else if (paidPlans.length > 0) {
    add(
      checks,
      'pass',
      'Product catalog',
      'Each paid plan uses its own Stripe Product.'
    )
  }

  if (webhookResult.status === 'fulfilled') {
    const endpoint = webhookResult.value.data.find(
      (item) => item.url === webhookUrl && item.status === 'enabled'
    )
    const enabled = new Set(endpoint?.enabled_events || [])
    const receivesAll = enabled.has('*')
    const missing = REQUIRED_WEBHOOK_EVENTS.filter(
      (event) => !receivesAll && !enabled.has(event)
    )

    add(
      checks,
      endpoint && missing.length === 0 ? 'pass' : 'fail',
      'Live webhook endpoint',
      !endpoint
        ? `No enabled endpoint found at ${webhookUrl}.`
        : missing.length > 0
          ? `Missing events: ${missing.join(', ')}`
          : 'Endpoint is enabled with every required billing event.'
    )

    if (endpoint) {
      add(
        checks,
        endpoint.api_version === Stripe.API_VERSION ? 'pass' : 'fail',
        'Webhook API version',
        endpoint.api_version === Stripe.API_VERSION
          ? `Endpoint uses ${Stripe.API_VERSION}.`
          : `Endpoint uses ${endpoint.api_version || 'the account default'}; runtime SDK uses ${Stripe.API_VERSION}. Align versions before cutover.`
      )
    }
  } else {
    add(
      checks,
      'fail',
      'Live webhook endpoint',
      'The live key cannot list webhook endpoints. Check restricted-key permissions.'
    )
  }

  if (portalResult.status === 'fulfilled') {
    const expectedPriceIds = new Set(
      paidPlans
        .map((plan) => plan.stripe_live_price_id)
        .filter((priceId): priceId is string => Boolean(priceId))
    )
    const configuration = portalResult.value.data.find(
      (item) =>
        item.active &&
        item.is_default &&
        item.livemode &&
        item.features.payment_method_update.enabled &&
        item.features.subscription_cancel.enabled &&
        item.features.subscription_update.enabled
    )
    const portalProducts =
      configuration?.features.subscription_update.products || []
    const portalPriceIds = new Set(
      portalProducts.flatMap((product) => product.prices)
    )
    const catalogMatches =
      expectedPriceIds.size === EXPECTED_PAID_PLANS.size &&
      portalPriceIds.size === expectedPriceIds.size &&
      [...expectedPriceIds].every((priceId) => portalPriceIds.has(priceId))
    const quantitiesLocked = portalProducts.every(
      (product) => !product.adjustable_quantity.enabled
    )
    const update = configuration?.features.subscription_update
    const priceChangesEnabled = Boolean(
      update?.default_allowed_updates.includes('price')
    )
    const immediateChanges =
      (update?.schedule_at_period_end.conditions.length || 0) === 0
    const prorationConfigured = update?.proration_behavior === 'always_invoice'
    const valid = Boolean(
      configuration &&
        catalogMatches &&
        quantitiesLocked &&
        priceChangesEnabled &&
        immediateChanges &&
        prorationConfigured
    )

    add(
      checks,
      valid ? 'pass' : 'fail',
      'Live Customer Portal',
      valid
        ? 'The default Live Portal has the exact Ciiya price catalog, fixed quantity, immediate price changes with always-invoice proration, payment-method updates, and cancellation.'
        : 'Configure the default Live Portal with all and only the three Ciiya live Prices, fixed quantity, immediate price changes, always-invoice proration, payment-method updates, and cancellation.'
    )
  } else {
    add(
      checks,
      'fail',
      'Live Customer Portal',
      'The preflight key cannot read Billing Portal configurations. Add Billing Portal read permission and retry.'
    )
  }

  if (
    activeTestResult.status === 'fulfilled' &&
    !activeTestResult.value.error
  ) {
    const count = activeTestResult.value.count || 0
    add(
      checks,
      count > 0 ? 'warn' : 'pass',
      'Test subscriptions',
      count > 0
        ? `${count} active test-mode subscription(s) remain isolated; review their storage entitlements before cutover.`
        : 'No active test-mode subscriptions require review.'
    )
  } else {
    add(
      checks,
      'fail',
      'Test subscriptions',
      'Cannot audit active Test subscriptions in production Supabase.'
    )
  }

  if (
    managedLiveResult.status === 'fulfilled' &&
    !managedLiveResult.value.error
  ) {
    const counts = new Map<string, number>()
    for (const row of managedLiveResult.value.data || []) {
      const userId = String(row.user_id)
      counts.set(userId, (counts.get(userId) || 0) + 1)
    }
    const duplicateOwners = [...counts.values()].filter((count) => count > 1)

    add(
      checks,
      duplicateOwners.length > 0 ? 'fail' : 'pass',
      'Concurrent Live subscriptions',
      duplicateOwners.length > 0
        ? `${duplicateOwners.length} user(s) have multiple managed Live subscriptions. Resolve duplicate billing before cutover.`
        : 'No user has multiple managed Live subscriptions.'
    )
  } else {
    add(
      checks,
      'fail',
      'Concurrent Live subscriptions',
      'Cannot audit duplicate managed Live subscriptions.'
    )
  }

  if (
    pendingDowngradeResult.status === 'fulfilled' &&
    !pendingDowngradeResult.value.error
  ) {
    const count = pendingDowngradeResult.value.count || 0
    add(
      checks,
      count > 0 ? 'fail' : 'pass',
      'Legacy scheduled downgrades',
      count > 0
        ? `${count} legacy pending downgrade(s) must be reconciled with Stripe and cleared manually.`
        : 'No legacy quota-only downgrade is pending.'
    )
  } else {
    add(
      checks,
      'fail',
      'Legacy scheduled downgrades',
      'Cannot audit pending legacy downgrades.'
    )
  }

  if (
    webhookCanaryResult.status === 'fulfilled' &&
    !webhookCanaryResult.value.error
  ) {
    const count = webhookCanaryResult.value.count || 0
    add(
      checks,
      count > 0 ? 'pass' : 'fail',
      'Live webhook canary',
      count > 0
        ? 'The configuration-bound internal signature/route/ledger smoke completed within the last 24 hours.'
        : 'Deploy Live mode with Checkout closed, run npm run stripe:webhook:canary with the apply gate, then rerun preflight.'
    )
  } else {
    add(
      checks,
      'fail',
      'Live webhook canary',
      'Cannot verify a completed Live webhook canary. Apply the billing-security migration and retry.'
    )
  }

  if (
    webhookOriginResult.status === 'fulfilled' &&
    !webhookOriginResult.value.error &&
    webhookOriginResult.value.data
  ) {
    const proof = webhookOriginResult.value.data

    try {
      const canonicalEvent = await runtimeStripe.events.retrieve(proof.event_id)
      const recordedCreatedAt = Math.floor(
        new Date(proof.event_created_at).getTime() / 1_000
      )
      const valid =
        canonicalEvent.id === proof.event_id &&
        canonicalEvent.type === proof.event_type &&
        canonicalEvent.livemode === true &&
        canonicalEvent.created === recordedCreatedAt

      add(
        checks,
        valid ? 'pass' : 'fail',
        'Stripe-origin webhook verification',
        valid
          ? 'A processed Live billing event was retrieved from the expected Stripe account and matches the current endpoint/secret/account fingerprint.'
          : 'The stored origin proof does not match the canonical Stripe event. Keep global Checkout closed.'
      )
    } catch {
      add(
        checks,
        'fail',
        'Stripe-origin webhook verification',
        'The runtime key cannot retrieve the recorded Live event. Add Events read permission or repeat the allowlisted real canary.'
      )
    }
  } else {
    add(
      checks,
      'fail',
      'Stripe-origin webhook verification',
      'No origin proof exists for the current endpoint/secret/account fingerprint. Complete an allowlisted real Live subscription before global rollout.'
    )
  }

  if (
    paidUsageResult.status === 'fulfilled' &&
    !paidUsageResult.value.error &&
    activeLiveResult.status === 'fulfilled' &&
    !activeLiveResult.value.error
  ) {
    const paidUsageRows = paidUsageResult.value.data || []
    const eligibleLiveRows = activeLiveResult.value.data || []
    const entitledLiveRows = eligibleLiveRows.filter(
      (row) => Boolean(row.entitlement_plan_id)
    )
    const liveOwners = new Set(
      entitledLiveRows.map((row) => String(row.user_id))
    )
    const unmatched = paidUsageRows.filter(
      (row) => !liveOwners.has(String(row.user_id))
    )
    const paidOwners = new Set(
      paidUsageRows.map((row) => String(row.user_id))
    )
    const missingEntitlement = entitledLiveRows.filter(
      (row) => !paidOwners.has(String(row.user_id))
    )
    const entitlementMismatch = entitledLiveRows.filter((subscription) => {
      const entitlementPlan = plans.find(
        (plan) => plan.id === subscription.entitlement_plan_id
      )
      const usage = paidUsageRows.find(
        (row) => String(row.user_id) === String(subscription.user_id)
      )

      return (
        !entitlementPlan ||
        (subscription.status !== 'past_due' &&
          subscription.entitlement_plan_id !== subscription.plan_id) ||
        !usage ||
        usage.current_plan !== entitlementPlan.slug ||
        Number(usage.storage_limit_bytes) !==
          Number(entitlementPlan.storage_limit_bytes)
      )
    })
    const consistent =
      unmatched.length === 0 &&
      missingEntitlement.length === 0 &&
      entitlementMismatch.length === 0

    add(
      checks,
      consistent ? 'pass' : 'fail',
      'Paid storage entitlements',
      consistent
        ? 'Every paid storage entitlement exactly matches the paid-evidence plan and quota of an eligible Live subscription; eligible subscriptions without paid evidence correctly remain on Free.'
        : `${unmatched.length} paid entitlement(s) lack an eligible paid-evidence Live subscription; ${missingEntitlement.length} paid-evidence Live subscription(s) lack a paid entitlement; ${entitlementMismatch.length} entitlement(s) have a mismatched subscription plan or quota. Reconcile before cutover.`
    )
  } else {
    add(
      checks,
      'fail',
      'Paid storage entitlements',
      'Cannot compare paid storage entitlements with Live subscriptions.'
    )
  }

  printChecks(checks)

  const failed = checks.filter((check) => check.status === 'fail').length
  const warned = checks.filter((check) => check.status === 'warn').length
  console.log(`Summary: ${failed} failed, ${warned} warning(s). No writes performed.`)
  process.exitCode = failed > 0 ? 1 : 0
}

main().catch((error) => {
  console.error(
    'Stripe live preflight failed safely:',
    error instanceof Error ? error.message : 'Unknown error'
  )
  process.exitCode = 1
})
