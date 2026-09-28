import { randomUUID } from 'node:crypto'
import { loadEnvConfig } from '@next/env'
import Stripe from 'stripe'
import {
  getStripeWebhookCanaryEventIdPrefix,
  inferStripeKeyMode,
} from '../src/lib/stripe-config'

loadEnvConfig(process.cwd())

const APPLY_ENABLED =
  process.env.STRIPE_WEBHOOK_CANARY_APPLY_ENABLED?.trim().toLowerCase() ===
  'true'

async function main() {
  const secret = process.env.STRIPE_LIVE_WEBHOOK_SECRET?.trim() || ''
  const runtimeKey = process.env.STRIPE_LIVE_RUNTIME_SECRET_KEY?.trim() || ''
  const endpoint = new URL(
    process.env.STRIPE_PREFLIGHT_WEBHOOK_URL?.trim() ||
      'https://ciiya.vercel.app/api/stripe/webhook'
  )

  if (!/^whsec_[A-Za-z0-9_-]{20,}$/.test(secret)) {
    throw new Error('STRIPE_LIVE_WEBHOOK_SECRET is missing or invalid.')
  }
  if (inferStripeKeyMode(runtimeKey) !== 'live') {
    throw new Error('STRIPE_LIVE_RUNTIME_SECRET_KEY must be a Live key.')
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.hostname === 'localhost' ||
    endpoint.hostname === '127.0.0.1'
  ) {
    throw new Error('Stripe webhook canary requires a public HTTPS endpoint.')
  }

  if (!APPLY_ENABLED) {
    console.log(
      `Stripe Live webhook canary is ready for ${endpoint.origin}. No request sent; set STRIPE_WEBHOOK_CANARY_APPLY_ENABLED=true for the approved cutover.`
    )
    return
  }

  const stripe = new Stripe(runtimeKey)
  const eventIdPrefix = getStripeWebhookCanaryEventIdPrefix(secret, endpoint)
  const payload = JSON.stringify({
    id: `${eventIdPrefix}${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    object: 'event',
    api_version: Stripe.API_VERSION,
    created: Math.floor(Date.now() / 1_000),
    data: {
      object: {
        id: 'ciiya_webhook_canary',
        object: 'ciiya.webhook_canary',
      },
    },
    livemode: true,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'ciiya.webhook_canary',
  })
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  })

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    body: payload,
    redirect: 'error',
  })

  if (!response.ok) {
    throw new Error(`Webhook canary failed with HTTP ${response.status}.`)
  }

  console.log(
    'Stripe Live webhook canary completed. Rerun npm run stripe:preflight:live before opening Checkout.'
  )
}

main().catch((error) => {
  console.error(
    'Stripe Live webhook canary failed safely:',
    error instanceof Error ? error.message : 'Unknown error'
  )
  process.exitCode = 1
})
