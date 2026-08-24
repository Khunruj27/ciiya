-- camera_live_imports.status='failed' was a dead end: getUntrackedFiles
-- treats any tracked filename (regardless of status) as "already seen",
-- so a single transient failure (e.g. a network blip during the
-- finalize-upload call) permanently dropped that photo from the
-- session with no automatic recovery path. Add a bounded retry counter
-- so the worker can safely retry a handful of times before giving up
-- for good.

alter table public.camera_live_imports
  add column if not exists retry_count integer not null default 0;
