import type Stripe from 'stripe'

export const STRIPE_MANAGED_SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused',
  'incomplete',
] as const

export function getCheckoutSubscriptionId(
  session: Stripe.Checkout.Session
) {
  return typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id ?? null
}

export function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const modern = invoice.parent?.subscription_details?.subscription

  if (typeof modern === 'string') return modern
  if (modern?.id) return modern.id

  const legacy = (
    invoice as Stripe.Invoice & {
      subscription?: string | { id?: string | null } | null
    }
  ).subscription

  if (typeof legacy === 'string') return legacy
  return legacy?.id ?? null
}

export function getInvoiceSubscriptionPriceIds(
  invoice: Stripe.Invoice,
  subscriptionId: string
) {
  const priceIds = invoice.lines.data.flatMap((line) => {
    // New API versions identify subscription lines through parent, not the
    // legacy line.subscription field. Never treat manual invoice items as
    // proof of a paid subscription price.
    if (line.parent && line.parent.type !== 'subscription_item_details') {
      return []
    }

    const legacy = line as Stripe.InvoiceLineItem & {
      type?: string
      price?: string | { id?: string | null } | null
    }
    if (!line.parent && legacy.type === 'invoiceitem') return []

    const lineSubscription = line.parent
      ? line.parent.subscription_item_details?.subscription
      : line.subscription
    const lineSubscriptionId =
      typeof lineSubscription === 'string'
        ? lineSubscription
        : lineSubscription?.id

    if (lineSubscriptionId !== subscriptionId) return []

    const price = line.pricing?.price_details?.price ?? legacy.price
    const priceId = typeof price === 'string' ? price : price?.id
    return priceId ? [priceId] : []
  })

  return [...new Set(priceIds)]
}

export function isUuid(value: string | null | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
  )
}
