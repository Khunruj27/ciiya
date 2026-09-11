-- Lock down anonymous reads of albums, photos, and face embeddings.
--
-- The previous "*_public_share_select" policies let anyone holding the public
-- anon key (which ships to the browser) read every album where
--   is_public = true AND share_token IS NOT NULL AND status = 'active'
-- WITHOUT presenting the actual share token. Because the row itself exposes
-- share_token, an anonymous caller could enumerate every public album, harvest
-- its secret token, and read all of its photos and photo_faces (face
-- embeddings) — defeating the share-link model entirely.
--
-- Public share pages no longer rely on this: all public reads run server-side
-- with the service role (see src/lib/share-data.ts) and validate the share
-- token in application code before any read. Removing these policies leaves the
-- anon role with no SELECT policy on these tables, so RLS denies it outright,
-- while album owners keep their own owner-scoped policies untouched.

drop policy if exists
  "albums_public_share_select"
on public.albums;

drop policy if exists
  "photos_public_share_select"
on public.photos;

drop policy if exists
  "photo_faces_public_share_select"
on public.photo_faces;
