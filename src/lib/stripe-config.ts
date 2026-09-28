import { createHmac } from 'node:crypto'

export type StripeMode = 'test' | 'live'
export type StripeLiveCheckoutRolloutMode = 'off' | 'canary' | 'all'

type StripeEnvironment = Record<string, string | undefined>

type StripeEnvironmentInspectionOptions = {
  requirePublishableKey?: boolean
}

export type StripeEnvironmentInspection = {
  mode: StripeMode
  liveEnabled: boolean
  secretKeyMode: StripeMode | null
  publishableKeyMode: StripeMode | null
  errors: string[]
}

export type StripePlanPriceFields = {
  stripe_price_id?: string | null
  stripe_live_price_id?: string | null
}

export const STRIPE_CHECKOUT_INTEGRATION_IDENTIFIER =
  'ciiya_subscription_qhmvzkxr'

function normalizeStripeWebhookEndpoint(value: string | URL) {
  const url = value instanceof URL ? new URL(value) : new URL(value)
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  return `${url.protocol}//${url.host}${pathname}`
}

export function getStripeWebhookConfigFingerprint(
  signingSecret: string,
  endpoint: string | URL,
  expectedAccountId = process.env.STRIPE_EXPECTED_LIVE_ACCOUNT_ID || ''
) {
  const secret = signingSecret.trim()
  const accountId = expectedAccountId.trim()

  if (!/^whsec_[A-Za-z0-9_-]{20,}$/.test(secret)) {
    throw new Error('A valid Stripe webhook signing secret is required.')
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    throw new Error('A valid expected Stripe Live account ID is required.')
  }

  return createHmac('sha256', secret)
    .update(
      [
        'ciiya-stripe-webhook-origin-v1',
        normalizeStripeWebhookEndpoint(endpoint),
        accountId,
      ].join('\0')
    )
    .digest('hex')
}

export function getStripeWebhookCanaryEventIdPrefix(
  signingSecret: string,
  endpoint: string | URL,
  expectedAccountId = process.env.STRIPE_EXPECTED_LIVE_ACCOUNT_ID || ''
) {
  const fingerprint = getStripeWebhookConfigFingerprint(
    signingSecret,
    endpoint,
    expectedAccountId
  ).slice(0, 24)

  return `evt_ciiya_canary_${fingerprint}_`
}

function parseMode(value: string | undefined): StripeMode | null {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'test' || normalized === 'live' ? normalized : null
}

function resolveStripeEnvironment(
  env: StripeEnvironment
): StripeEnvironment {
  const mode = parseMode(env.STRIPE_MODE) ?? 'test'

  if (mode !== 'live') return env

  return {
    ...env,
    STRIPE_SECRET_KEY:
      env.STRIPE_LIVE_RUNTIME_SECRET_KEY?.trim() || env.STRIPE_SECRET_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      env.STRIPE_LIVE_PUBLISHABLE_KEY?.trim() ||
      env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  }
}

export function inferStripeKeyMode(value: string | undefined) {
  const match = value?.trim().match(/^(?:sk|rk|pk)_(test|live)_/)
  return (match?.[1] as StripeMode | undefined) ?? null
}

export function inspectStripeEnvironment(
  env: StripeEnvironment = process.env,
  options: StripeEnvironmentInspectionOptions = {}
): StripeEnvironmentInspection {
  const resolvedEnv = resolveStripeEnvironment(env)
  const configuredMode = env.STRIPE_MODE?.trim().toLowerCase()
  const mode = parseMode(configuredMode) ?? 'test'
  const liveEnabled = env.STRIPE_LIVE_ENABLED?.trim().toLowerCase() === 'true'
  const secretKeyMode = inferStripeKeyMode(resolvedEnv.STRIPE_SECRET_KEY)
  const publishableKeyMode = inferStripeKeyMode(
    resolvedEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  )
  const errors: string[] = []

  if (configuredMode && !parseMode(configuredMode)) {
    errors.push('STRIPE_MODE must be either test or live.')
  }

  if (!resolvedEnv.STRIPE_SECRET_KEY?.trim()) {
    errors.push('STRIPE_SECRET_KEY is required when Stripe billing is enabled.')
  } else if (!secretKeyMode) {
    errors.push('STRIPE_SECRET_KEY must be a Stripe test or live secret/restricted key.')
  } else if (secretKeyMode !== mode) {
    errors.push(`STRIPE_SECRET_KEY does not match STRIPE_MODE=${mode}.`)
  }

  if (
    resolvedEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() &&
    !publishableKeyMode
  ) {
    errors.push(
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a Stripe test or live publishable key.'
    )
  } else if (publishableKeyMode && publishableKeyMode !== mode) {
    errors.push(
      `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY does not match STRIPE_MODE=${mode}.`
    )
  }

  if (
    options.requirePublishableKey &&
    !resolvedEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()
  ) {
    errors.push(
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required for this Stripe readiness check.'
    )
  }

  if (mode === 'live' && !liveEnabled) {
    errors.push(
      'Live Stripe access is locked. Set STRIPE_LIVE_ENABLED=true only during the approved cutover.'
    )
  }

  return {
    mode,
    liveEnabled,
    secretKeyMode,
    publishableKeyMode,
    errors,
  }
}

export function isStripeCheckoutEnabled(
  env: StripeEnvironment = process.env
) {
  const configured = env.STRIPE_CHECKOUT_ENABLED?.trim().toLowerCase()
  const mode = parseMode(env.STRIPE_MODE) ?? 'test'

  if (configured === 'false') return false

  if (mode === 'live') {
    const liveWebhookSecret = env.STRIPE_LIVE_WEBHOOK_SECRET?.trim() || ''

    return (
      configured === 'true' &&
      /^whsec_[A-Za-z0-9_-]{20,}$/.test(liveWebhookSecret)
    )
  }

  // Keep existing Test environments backward-compatible, but require an
  // explicit, verified webhook gate before Live can create subscriptions.
  return true
}

export function getStripeLiveCheckoutRolloutMode(
  env: StripeEnvironment = process.env
): StripeLiveCheckoutRolloutMode {
  const value = env.STRIPE_LIVE_CHECKOUT_ROLLOUT_MODE?.trim().toLowerCase()
  return value === 'canary' || value === 'all' ? value : 'off'
}

export function isStripeLiveCheckoutOwnerAllowed(
  ownerId: string,
  env: StripeEnvironment = process.env
) {
  const mode = getStripeLiveCheckoutRolloutMode(env)
  if (mode === 'all') return true
  if (mode !== 'canary') return false

  const normalizedOwnerId = ownerId.trim().toLowerCase()
  const canaryOwners = (env.STRIPE_LIVE_CHECKOUT_CANARY_OWNER_IDS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        value
      )
    )

  return canaryOwners.includes(normalizedOwnerId)
}

export function getStripeMode(
  env: StripeEnvironment = process.env
): StripeMode {
  const inspection = inspectStripeEnvironment({
    STRIPE_MODE: env.STRIPE_MODE,
    STRIPE_LIVE_ENABLED: env.STRIPE_LIVE_ENABLED,
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || 'sk_test_mode_selection_only',
  })

  const modeErrors = inspection.errors.filter(
    (error) =>
      error.startsWith('STRIPE_MODE') ||
      error.startsWith('Live Stripe access is locked')
  )

  if (modeErrors.length > 0) {
    throw new Error(`Invalid Stripe mode: ${modeErrors.join(' ')}`)
  }

  return inspection.mode
}

export function getStripeRuntimeConfig(
  env: StripeEnvironment = process.env
) {
  const inspection = inspectStripeEnvironment(env)
  const resolvedEnv = resolveStripeEnvironment(env)

  if (inspection.errors.length > 0) {
    throw new Error(
      `Invalid Stripe configuration: ${inspection.errors.join(' ')}`
    )
  }

  return {
    mode: inspection.mode,
    secretKey: resolvedEnv.STRIPE_SECRET_KEY!.trim(),
  }
}

export function getStripeWebhookSecret(
  env: StripeEnvironment = process.env
) {
  const mode = parseMode(env.STRIPE_MODE) ?? 'test'
  const secret =
    mode === 'live'
      ? env.STRIPE_LIVE_WEBHOOK_SECRET?.trim()
      : env.STRIPE_WEBHOOK_SECRET?.trim()

  return secret || null
}

export function getStripeSiteUrl(
  env: StripeEnvironment = process.env
) {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim()

  if (!raw) {
    throw new Error('NEXT_PUBLIC_SITE_URL is required for Stripe billing.')
  }

  let url: URL

  try {
    url = new URL(raw)
  } catch {
    throw new Error('NEXT_PUBLIC_SITE_URL must be a valid absolute URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_SITE_URL must use HTTP or HTTPS.')
  }

  if (
    env.NODE_ENV === 'production' &&
    (url.protocol !== 'https:' ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1')
  ) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be a public HTTPS URL in production.'
    )
  }

  return url.origin
}

export function getStripePriceColumn(mode: StripeMode) {
  return mode === 'live' ? 'stripe_live_price_id' : 'stripe_price_id'
}

export function getStripePriceId(
  plan: StripePlanPriceFields,
  mode: StripeMode
) {
  const value =
    mode === 'live' ? plan.stripe_live_price_id : plan.stripe_price_id
  return value?.trim() || null
}

export function stripeModeFromLivemode(livemode: boolean): StripeMode {
  return livemode ? 'live' : 'test'
}
