import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Retired: the legacy Free branch changed the database without canceling the
 * Stripe subscription. Cancellation and downgrades now belong to the Stripe
 * Customer Portal so a customer can never be shown as Free while still billed.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Direct downgrades are retired. Open billing management to change or cancel your subscription.',
    },
    { status: 410 }
  )
}
