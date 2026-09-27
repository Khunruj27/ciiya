import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Retired: this legacy endpoint changed quota directly without a Stripe
 * subscription mutation. Paid plan changes must use the Stripe routes so the
 * webhook remains the source of truth for entitlement updates.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'This billing route has been retired. Use Stripe Checkout.',
    },
    { status: 410 }
  )
}
