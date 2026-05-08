import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    success: true,
    disabled: true,
    message:
      'Auto worker on web app is disabled. Photo processing is handled by Railway worker.',
  })
}