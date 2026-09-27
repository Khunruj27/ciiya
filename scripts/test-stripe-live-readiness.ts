import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  getStripePriceId,
  getStripeRuntimeConfig,
  inferStripeKeyMode,
  inspectStripeEnvironment,
} from '../src/lib/stripe-config'

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

  const webhook = await readFile(
    new URL('../src/app/api/stripe/webhook/route.ts', import.meta.url),
    'utf8'
  )
  for (const event of [
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'invoice.paid',
    'invoice.payment_failed',
  ]) {
    assert.match(webhook, new RegExp(event.replaceAll('.', '\\.')))
  }
  assert.match(webhook, /constructEvent/)
  assert.match(webhook, /stripeModeFromLivemode/)

  const preflight = await readFile(
    new URL('./stripe-live-preflight.ts', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(
    preflight,
    /stripe\.(?:customers|prices|products|webhookEndpoints|subscriptions)\.(?:create|update|del)\s*\(/
  )
  assert.match(preflight, /No writes performed/)

  for (const retiredRoute of [
    '../src/app/api/billing/change-plan/route.ts',
    '../src/app/albums/[id]/change-plan/route.ts',
  ]) {
    const source = await readFile(new URL(retiredRoute, import.meta.url), 'utf8')
    assert.match(source, /status: 410/)
    assert.doesNotMatch(source, /user_storage_usage|\.from\(['"]subscriptions/)
  }

  console.log('Stripe live-readiness checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
