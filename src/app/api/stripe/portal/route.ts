import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Retired duplicate. The supported endpoint is /api/stripe/billing-portal.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'This billing endpoint has moved to /api/stripe/billing-portal.',
    },
    { status: 410 }
  )
}
