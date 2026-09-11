-- Drop a legacy, untracked RLS policy that leaked private albums.
--
-- "Public can view shared albums" was created outside migrations (via the
-- dashboard) and its USING clause is only `status <> 'deleted'` — it has NO
-- is_public / share_token check at all. That let any anon caller read EVERY
-- non-deleted album, private ones included. Dropping the tracked
-- albums_public_share_select policy in 202609110001 did nothing while this one
-- remained. Public share reads now run server-side with the service role
-- (src/lib/share-data.ts), so no anon SELECT policy on albums is needed; the
-- owner-scoped albums_select_own (auth.uid() = user_id) stays untouched.

drop policy if exists
  "Public can view shared albums"
on public.albums;
