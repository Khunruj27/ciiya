import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Retired: mutating a paid subscription directly could grant storage before
 * Stripe collected the invoice. Existing subscribers must use the Stripe
 * Customer Portal, where payment recovery and plan changes remain in Stripe.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Direct plan changes are retired. Open billing management to change your subscription.',
    },
    { status: 410 }
  )
}
