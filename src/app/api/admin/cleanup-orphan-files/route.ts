import type { NextRequest } from 'next/server'
import { POST as runCanonicalCleanup } from '@/app/api/storage/cleanup-orphan/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Backward-compatible alias. The canonical handler is provider-aware and
// defaults to dry-run, unlike the previous route which deleted immediately.
export async function POST(req: NextRequest) {
  return runCanonicalCleanup(req)
}
