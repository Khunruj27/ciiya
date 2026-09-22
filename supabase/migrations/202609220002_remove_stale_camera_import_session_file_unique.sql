-- Some production databases still carry an early, manually-created unique
-- constraint/index on (session_id, camera_file_id). camera_file_id is only the
-- current position reported by gphoto2 and can be reassigned whenever the
-- card listing changes. Keeping that uniqueness rule makes a newly captured
-- file collide with an older baseline row before the canonical
-- (album_id, filename) upsert can run.
--
-- Drop only the stale rule. The stable album/filename uniqueness remains the
-- source of truth and continues to prevent duplicate imports.

alter table public.camera_live_imports
  drop constraint if exists camera_live_imports_session_file_uidx;

drop index if exists public.camera_live_imports_session_file_uidx;

drop index if exists public.idx_camera_live_imports_unique_file;

create unique index if not exists idx_camera_live_imports_unique_filename
  on public.camera_live_imports(album_id, filename);
