-- Align the remote face_jobs table with V56 workers.
-- The worker writes both retry_count and retries.

alter table public.face_jobs
  add column if not exists retry_count integer default 0,
  add column if not exists retries integer default 0;

update public.face_jobs
set
  retry_count = coalesce(retry_count, 0),
  retries = coalesce(retries, retry_count, 0)
where retry_count is null
   or retries is null;

alter table public.face_jobs
  alter column retry_count set default 0,
  alter column retries set default 0;

notify pgrst, 'reload schema';