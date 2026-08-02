-- camera_file_id is gphoto2's position in the current --list-files
-- listing, not a persistent identifier - it changes across reconnects,
-- so the same physical shot was getting re-imported as a "new" file
-- every time the camera reconnected, creating duplicate photos.
-- filename is what's actually stable for a given card, so dedup moves
-- to (album_id, filename) instead.

drop index if exists public.idx_camera_live_imports_unique_file;

create unique index if not exists idx_camera_live_imports_unique_filename
on public.camera_live_imports(album_id, filename);
