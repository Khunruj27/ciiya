import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The bell badge total = unread activity (share_events) + unread platform
 * announcements. Every page that seeds the bell and the count API call this
 * one helper, so the number is identical everywhere. `supabase` must be the
 * user-scoped (cookie) client — announcement visibility relies on that RLS.
 */
export async function getUnreadNotificationCount(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const [activityResult, announcementResult] = await Promise.all([
    supabase
      .from('share_events')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .is('read_at', null),
    supabase
      .from('announcements')
      .select('id, announcement_reads(read_at)')
      .limit(50),
  ])

  // A missing/temporarily unavailable announcement feed must not hide valid
  // guest activity (and vice versa). Previously both query errors were
  // discarded, which made a database problem indistinguishable from a real
  // zero and caused the bell to disappear without any diagnostic signal.
  if (activityResult.error) {
    console.error(
      '[notifications] unread activity count failed:',
      activityResult.error.message
    )
  }
  if (announcementResult.error) {
    console.error(
      '[notifications] unread announcement count failed:',
      announcementResult.error.message
    )
  }

  const unreadAnnouncements = (announcementResult.data || []).filter((announcement) => {
    const read = Array.isArray(announcement.announcement_reads)
      ? announcement.announcement_reads[0]
      : announcement.announcement_reads
    return !read?.read_at
  }).length

  return Number(activityResult.count || 0) + unreadAnnouncements
}
