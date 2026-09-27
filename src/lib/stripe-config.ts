export type StripeMode = 'test' | 'live'

type StripeEnvironment = Record<string, string | undefined>

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

function parseMode(value: string | undefined): StripeMode | null {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'test' || normalized === 'live' ? normalized : null
}

export function inferStripeKeyMode(value: string | undefined) {
  const match = value?.trim().match(/^(?:sk|rk|pk)_(test|live)_/)
  return (match?.[1] as StripeMode | undefined) ?? null
}

export function inspectStripeEnvironment(
  env: StripeEnvironment = process.env
): StripeEnvironmentInspection {
  const configuredMode = env.STRIPE_MODE?.trim().toLowerCase()
  const mode = parseMode(configuredMode) ?? 'test'
  const liveEnabled = env.STRIPE_LIVE_ENABLED?.trim().toLowerCase() === 'true'
  const secretKeyMode = inferStripeKeyMode(env.STRIPE_SECRET_KEY)
  const publishableKeyMode = inferStripeKeyMode(
    env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  )
  const errors: string[] = []

  if (configuredMode && !parseMode(configuredMode)) {
    errors.push('STRIPE_MODE must be either test or live.')
  }

  if (!env.STRIPE_SECRET_KEY?.trim()) {
    errors.push('STRIPE_SECRET_KEY is required when Stripe billing is enabled.')
  } else if (!secretKeyMode) {
    errors.push('STRIPE_SECRET_KEY must be a Stripe test or live secret/restricted key.')
  } else if (secretKeyMode !== mode) {
    errors.push(`STRIPE_SECRET_KEY does not match STRIPE_MODE=${mode}.`)
  }

  if (
    env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() &&
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

  if (inspection.errors.length > 0) {
    throw new Error(
      `Invalid Stripe configuration: ${inspection.errors.join(' ')}`
    )
  }

  return {
    mode: inspection.mode,
    secretKey: env.STRIPE_SECRET_KEY!.trim(),
  }
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
