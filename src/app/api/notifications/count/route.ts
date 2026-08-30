import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Unread notification count for the signed-in owner. Read with the server
// (cookie) session, which authenticates reliably — the notification bell polls
// this and refreshes it on realtime pings.
export async function GET() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { count: 0 },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    )
  }

  const { count } = await supabase
    .from('share_events')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)
    .is('read_at', null)

  return NextResponse.json(
    { count: count || 0 },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
