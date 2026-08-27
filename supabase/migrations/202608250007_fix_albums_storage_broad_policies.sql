-- SECURITY FIX — over-permissive storage RLS on the `albums` bucket.
--
-- Four policies created outside the migration history (via the Supabase
-- Dashboard) granted EVERY authenticated user full access to the whole
-- `albums` bucket, checking only `bucket_id = 'albums'` with no per-user
-- folder scoping:
--
--   "Authenticated users can upload album files"  (INSERT)
--   "Authenticated users can update album files"  (UPDATE)
--   "Authenticated users can delete album files"  (DELETE)
--   "Authenticated users can view album files"    (SELECT)
--
-- Because Postgres OR's permissive policies together, these defeated the
-- folder-scoped album_storage_auth_* policies entirely. Confirmed by test:
-- a signed-in user could upload into, overwrite, list, and DELETE files in
-- any other user's folder — arbitrary tampering and data loss across the
-- whole bucket, gated only by having any account.
--
-- Dropping them leaves the storage model defined solely by the migrations:
--   album_storage_auth_upload / _update / _delete  — authenticated writes,
--     each restricted to a folder named by the caller's own auth.uid()
--   album_storage_public_read                      — public read (by design;
--     shared galleries are public, so legitimate viewing is unaffected)
--
-- App uploads already write to `{uid}/...` paths, so no legitimate flow
-- relies on the broad policies. The SELECT one is redundant with the public
-- read policy, so viewing keeps working after it is removed.

drop policy if exists "Authenticated users can upload album files" on storage.objects;
drop policy if exists "Authenticated users can update album files" on storage.objects;
drop policy if exists "Authenticated users can delete album files" on storage.objects;
drop policy if exists "Authenticated users can view album files" on storage.objects;
