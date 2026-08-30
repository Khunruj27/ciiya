import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function PATCH() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabase
      .from('share_events')
      .update({ read_at: new Date().toISOString() })
      .eq('owner_id', user.id)
      .is('read_at', null)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[notifications/read] update failed:', error)
    return NextResponse.json({ error: 'Unable to update notifications' }, { status: 500 })
  }
}

