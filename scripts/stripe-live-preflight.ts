import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import {
  inferStripeKeyMode,
  inspectStripeEnvironment,
} from '../src/lib/stripe-config'

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
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const

const EXPECTED_PAID_PLANS = new Map([
  ['starter', 299],
  ['pro', 499],
  ['business', 699],
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
  const publishableKey =
    process.env.STRIPE_PREFLIGHT_PUBLISHABLE_KEY?.trim()
  const webhookSecret = process.env.STRIPE_PREFLIGHT_WEBHOOK_SECRET?.trim()
  const webhookUrl =
    process.env.STRIPE_PREFLIGHT_WEBHOOK_URL?.trim() ||
    'https://ciiya.vercel.app/api/stripe/webhook'

  const inspection = inspectStripeEnvironment({
    STRIPE_MODE: 'live',
    STRIPE_LIVE_ENABLED: 'true',
    STRIPE_SECRET_KEY: secretKey,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: publishableKey,
  })

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

  if (webhookSecret?.startsWith('whsec_')) {
    add(checks, 'pass', 'Webhook secret', 'A signing secret is configured.')
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

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const stripe = new Stripe(secretKey)

  const [accountResult, plansResult, webhookResult, activeTestResult] =
    await Promise.allSettled([
      stripe.accounts.retrieve(null),
      supabase
        .from('plans')
        .select(
          'id, slug, name, price_thb, is_active, stripe_price_id, stripe_live_price_id'
        )
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      stripe.webhookEndpoints.list({ limit: 100 }),
      supabase
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('stripe_mode', 'test')
        .in('status', ['active', 'trialing', 'past_due']),
    ])

  if (accountResult.status === 'fulfilled') {
    const account = accountResult.value
    const ready = account.details_submitted && account.charges_enabled
    add(
      checks,
      ready ? 'pass' : 'fail',
      'Stripe account',
      ready
        ? `Account ${account.id} can accept live charges.`
        : 'Account onboarding or live charges are not enabled yet.'
    )
  } else {
    add(
      checks,
      'fail',
      'Stripe account',
      'The live key cannot read account readiness. Check restricted-key permissions.'
    )
  }

  let plans: Array<{
    id: string
    slug: string
    name: string
    price_thb: number
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
        productIsActive

      if (typeof price.product === 'string') products.add(price.product)
      else if (price.product?.id) products.add(price.product.id)

      add(
        checks,
        valid ? 'pass' : 'fail',
        `Plan ${plan.slug}`,
        valid
          ? `Live THB monthly Price matches ${plan.price_thb} THB.`
          : 'Live Price must be active, monthly, THB, match the database amount, and use an active Product.'
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
  } else {
    add(
      checks,
      'fail',
      'Live webhook endpoint',
      'The live key cannot list webhook endpoints. Check restricted-key permissions.'
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
