import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const rawAnnouncementIds: unknown[] = Array.isArray(body?.announcementIds)
      ? body.announcementIds
      : []
    const announcementIds: string[] = [
      ...new Set(
        rawAnnouncementIds
          .map((value) => String(value).trim())
          .filter((id) => id.length > 0 && id.length <= 100)
      ),
    ].slice(0, 100)
    const rawShareEventIds: unknown[] = Array.isArray(body?.shareEventIds)
      ? body.shareEventIds
      : []
    const shareEventIds: string[] = [
      ...new Set(
        rawShareEventIds
          .map((value) => String(value).trim())
          .filter((id) => id.length > 0 && id.length <= 100)
      ),
    ].slice(0, 100)
    const clickedId = String(body?.clickedId || '').trim()
    const now = new Date().toISOString()

    if (body?.markAllActivity === true) {
      const { error } = await supabase
        .from('share_events')
        .update({ read_at: now })
        .eq('owner_id', user.id)
        .is('read_at', null)
      if (error) throw new Error(error.message)
    } else if (shareEventIds.length) {
      const { error } = await supabase
        .from('share_events')
        .update({ read_at: now })
        .eq('owner_id', user.id)
        .in('id', shareEventIds)
      if (error) throw new Error(error.message)
    }

    if (announcementIds.length) {
      const { error: announcementError } = await supabase
        .from('announcement_reads')
        .upsert(
          announcementIds.map((announcementId) => ({
            announcement_id: announcementId,
            user_id: user.id,
            read_at: now,
          })),
          { onConflict: 'announcement_id,user_id' }
        )
      if (announcementError) throw new Error(announcementError.message)
    }

    if (clickedId) {
      const { error: clickError } = await supabase
        .from('announcement_reads')
        .upsert({
          announcement_id: clickedId,
          user_id: user.id,
          read_at: now,
          clicked_at: now,
        }, { onConflict: 'announcement_id,user_id' })
      if (clickError) throw new Error(clickError.message)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[notifications/read] update failed:', error)
    return NextResponse.json({ error: 'Unable to update notifications' }, { status: 500 })
  }
}
