#!/usr/bin/env node
/**
 * Creates (or reuses) the three subscription prices in Stripe and prints their
 * price IDs, ready to drop into the `plans` table.
 *
 * Run it yourself with your LIVE key so the key never leaves your machine:
 *
 *   STRIPE_SECRET_KEY=sk_live_xxx node scripts/create-live-stripe-prices.mjs
 *
 * It is idempotent: a matching active price (same product name, amount, THB,
 * monthly) is reused instead of creating a duplicate. To (re)create in test
 * mode on purpose, add ALLOW_TEST=1.
 */

const sk = process.env.STRIPE_SECRET_KEY || ''

if (!sk) {
  console.error('✗ STRIPE_SECRET_KEY is not set. Run:')
  console.error('  STRIPE_SECRET_KEY=sk_live_xxx node scripts/create-live-stripe-prices.mjs')
  process.exit(1)
}

// Accept both standard (sk_) and restricted (rk_) keys.
const isLive = sk.startsWith('sk_live_') || sk.startsWith('rk_live_')
const isTest = sk.startsWith('sk_test_') || sk.startsWith('rk_test_')

console.log(`Stripe mode: ${isLive ? '🔴 LIVE' : isTest ? '🧪 TEST' : '(unknown)'}`)

if (!isLive && process.env.ALLOW_TEST !== '1') {
  console.error(
    '✗ Key is not a live key (sk_live_ / rk_live_). Refusing so you do not\n' +
      '  accidentally create test prices. If that is intentional, re-run with ALLOW_TEST=1.'
  )
  process.exit(1)
}

// Product name → amount in satang (THB * 100). Names match the existing catalog.
const PLANS = [
  { plan: 'Starter', product: '20GB Plan', amount: 29900 },
  { plan: 'Pro', product: '50GB Plan', amount: 49900 },
  { plan: 'Business', product: '100GB Plan', amount: 69900 },
]

const CURRENCY = 'thb'
const INTERVAL = 'month'

const AUTH = { Authorization: `Bearer ${sk}` }

async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: AUTH })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json
}

async function stripePost(path, form) {
  const body = new URLSearchParams(form).toString()
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json
}

async function findExistingPrice(productName, amount) {
  // Scan active prices (with product expanded) for an exact match.
  let startingAfter = null
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({
      active: 'true',
      limit: '100',
      'expand[]': 'data.product',
    })
    if (startingAfter) query.set('starting_after', startingAfter)

    const list = await stripeGet(`prices?${query.toString()}`)

    for (const price of list.data) {
      const product =
        price.product && typeof price.product === 'object'
          ? price.product.name
          : null
      if (
        product === productName &&
        price.unit_amount === amount &&
        price.currency === CURRENCY &&
        price.recurring?.interval === INTERVAL
      ) {
        return price.id
      }
    }

    if (!list.has_more) break
    startingAfter = list.data[list.data.length - 1]?.id
  }
  return null
}

async function ensurePrice({ plan, product, amount }) {
  const existing = await findExistingPrice(product, amount)
  if (existing) {
    console.log(`  = ${plan.padEnd(9)} reused ${existing}  (${product}, ${amount / 100} THB/mo)`)
    return { plan, priceId: existing }
  }

  const createdProduct = await stripePost('products', { name: product })
  const createdPrice = await stripePost('prices', {
    product: createdProduct.id,
    unit_amount: String(amount),
    currency: CURRENCY,
    'recurring[interval]': INTERVAL,
  })

  console.log(`  + ${plan.padEnd(9)} created ${createdPrice.id}  (${product}, ${amount / 100} THB/mo)`)
  return { plan, priceId: createdPrice.id }
}

async function main() {
  console.log('\nEnsuring subscription prices...\n')
  const results = []
  for (const p of PLANS) {
    results.push(await ensurePrice(p))
  }

  console.log('\n──────────── price IDs (send these back) ────────────')
  for (const r of results) {
    console.log(`  ${r.plan}: ${r.priceId}`)
  }
  console.log('─────────────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('✗ Failed:', err.message)
  process.exit(1)
})
