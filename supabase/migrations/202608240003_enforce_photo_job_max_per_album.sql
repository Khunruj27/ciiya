-- PHOTO_JOB_MAX_PER_ALBUM was read by the worker and reported in
-- heartbeat/metrics, but never actually enforced by the claim RPC —
-- claim_next_photo_job only prevented double-claiming the same photo_id,
-- not concurrent jobs within the same album. Add an optional
-- max_per_album parameter and honor it. The old single-arg overload is
-- dropped so there's no ambiguity about which signature callers hit.
--
-- NOTE: this version's enforcement is a plain count comparison and
-- races under concurrent claim calls (see the immediately-following
-- migration, 202608240004, which replaces this function to fix it).
-- Kept as-is for migration history accuracy.

drop function if exists public.claim_next_photo_job(text);

create or replace function public.claim_next_photo_job(
  worker_name text,
  max_per_album integer default null
)
returns setof public.photo_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with selected_job as (
    select pj.id
    from public.photo_jobs pj
    where pj.status = 'pending'
      and not exists (
        select 1
        from public.photo_jobs active
        where active.photo_id = pj.photo_id
          and active.id <> pj.id
          and active.status = 'processing'
      )
      and (
        max_per_album is null
        or (
          select count(*)
          from public.photo_jobs active_album
          where active_album.album_id = pj.album_id
            and active_album.status = 'processing'
        ) < max_per_album
      )
    order by pj.priority asc, pj.created_at asc
    limit 1
    for update skip locked
  ), claimed_job as (
    update public.photo_jobs pj
    set
      status = 'processing',
      progress = 5,
      started_at = now(),
      finished_at = null,
      error = null,
      worker_id = worker_name,
      claimed_by = worker_name,
      updated_at = now()
    where pj.id in (select selected_job.id from selected_job)
    returning pj.*
  )
  select * from claimed_job;
end;
$$;

grant execute on function public.claim_next_photo_job(text, integer) to service_role;
