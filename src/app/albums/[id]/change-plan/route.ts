import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Retired: album-scoped plan changes bypassed Stripe billing. The supported
 * flow is /api/stripe/checkout for a new subscription and
 * /api/stripe/change-plan for an existing subscription.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'This plan-change route has been retired. Use Stripe billing.',
    },
    { status: 410 }
  )
}
