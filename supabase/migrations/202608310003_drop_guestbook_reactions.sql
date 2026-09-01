-- Remove the unshipped guestbook + photo-reactions feature.
-- The original photo_likes like feature (photo_likes table + toggle_photo_like)
-- is intentionally kept.

-- Photo reactions (the one-reaction-per-guest engagement layered over likes).
drop function if exists public.set_photo_reaction(uuid, text, text);
drop table if exists public.photo_reactions;
alter table public.photos drop column if exists reaction_counts;

-- Digital guestbook.
drop table if exists public.guestbook_entries;

-- Restore share_events' allowed types to the pre-guestbook set. Any guestbook
-- activity rows must go first, or the stricter constraint can't be re-added.
delete from public.share_events where event_type = 'guestbook_signed';

alter table public.share_events
  drop constraint if exists share_events_type_check;

alter table public.share_events
  add constraint share_events_type_check check (
    event_type in (
      'album_view', 'photo_download', 'photo_like',
      'moment_created', 'moment_like', 'face_search'
    )
  );
