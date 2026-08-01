-- src/app/api/albums/settings/route.ts (PATCH) has always sent
-- is_password_protected / password_hash on every album settings save, but
-- these columns were never added to public.albums in any tracked migration
-- or in schema.sql. If they are missing on the live database, every album
-- settings save fails outright (title/description/download settings
-- included), since PostgREST rejects the whole update when it references
-- unknown columns. Add them idempotently so the settings form (and the new
-- share-password gate) work.

alter table public.albums
  add column if not exists is_password_protected boolean not null default false,
  add column if not exists password_hash text;

notify pgrst, 'reload schema';
