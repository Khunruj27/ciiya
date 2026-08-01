import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    {
      success: false,
      disabled: true,
      message:
        'process-photos route disabled. Use workers/photo-worker.ts instead.',
    },
    {
      status: 410,
    }
  )
}

export function POST() {
  return NextResponse.json(
    {
      success: false,
      disabled: true,
      message:
        'process-photos route disabled. Use workers/photo-worker.ts instead.',
    },
    {
      status: 410,
    }
  )
}