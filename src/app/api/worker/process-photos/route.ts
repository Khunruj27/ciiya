import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isDebugAllowed(req: NextRequest) {
  const workerSecret = process.env.WORKER_SECRET

  if (!workerSecret) {
    return false
  }

  const authHeader = req.headers.get('authorization')
  const cronSecret = req.headers.get('x-worker-secret')

  return authHeader === `Bearer ${workerSecret}` || cronSecret === workerSecret
}

function getMessage() {
  return {
    success: false,
    disabled: true,
    movedTo: 'Railway Worker',
    message:
      'Photo processing has been moved to Railway worker. This Vercel API no longer processes jobs.',
  }
}

export async function GET(req: NextRequest) {
  if (!isDebugAllowed(req)) {
    return NextResponse.json(getMessage(), { status: 403 })
  }

  return NextResponse.json({
    ...getMessage(),
    debug: true,
    hint:
      'Railway worker should process photo_jobs directly from Supabase. Do not use this endpoint for production processing.',
  })
}

export async function POST(req: NextRequest) {
  if (!isDebugAllowed(req)) {
    return NextResponse.json(getMessage(), { status: 403 })
  }

  return NextResponse.json({
    ...getMessage(),
    debug: true,
    hint:
      'Railway worker should process photo_jobs directly from Supabase. Do not use this endpoint for production processing.',
  })
}