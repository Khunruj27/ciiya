-- The camera-live-import worker upserts into camera_live_imports using
-- ON CONFLICT (album_id, camera_file_id), but that unique index was only
-- ever defined in schema.sql and never migrated into the live database.
-- Every upsert has been failing with "no unique or exclusion constraint
-- matching the ON CONFLICT specification", so downloaded camera files
-- never got a local_path row and silently never uploaded.

create unique index if not exists idx_camera_live_imports_unique_file
on public.camera_live_imports(album_id, camera_file_id);
