import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workerSecret = process.env.WORKER_SECRET

    const res = await fetch(
      `${req.nextUrl.origin}/api/worker/process-photos?limit=5&concurrency=1`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: workerSecret
          ? {
              'x-worker-secret': workerSecret,
            }
          : {},
      }
    )

    const data = await res.json().catch(() => null)

    return NextResponse.json({
      success: res.ok,
      worker: data,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Manual worker failed',
      },
      { status: 500 }
    )
  }
}