-- The previous version of claim_next_photo_job (this migration's
-- predecessor) enforced max_per_album with a plain count comparison,
-- which raced under the worker's real call pattern (WORKER_LIMIT
-- concurrent RPC calls per poll): every concurrent transaction read
-- the same pre-commit "processing count" snapshot and all proceeded to
-- claim, so the cap was not actually enforced. Verified empirically:
-- 3 concurrent claims against one album with max_per_album=1 all
-- succeeded. Fixed by taking a per-album advisory lock (transaction-
-- scoped, auto-released) before evaluating the count, so concurrent
-- claims for the same album serialize while different albums remain
-- fully parallel.

create or replace function public.claim_next_photo_job(
  worker_name text,
  max_per_album integer default null
)
returns setof public.photo_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  got_album_lock boolean;
  current_album_count integer;
begin
  for candidate in
    select pj.id, pj.album_id
    from public.photo_jobs pj
    where pj.status = 'pending'
      and not exists (
        select 1
        from public.photo_jobs active
        where active.photo_id = pj.photo_id
          and active.id <> pj.id
          and active.status = 'processing'
      )
    order by pj.priority asc, pj.created_at asc
    limit 50
    for update of pj skip locked
  loop
    if max_per_album is not null then
      got_album_lock := pg_try_advisory_xact_lock(hashtext(candidate.album_id::text)::bigint);

      if not got_album_lock then
        continue;
      end if;

      select count(*)
      into current_album_count
      from public.photo_jobs
      where album_id = candidate.album_id
        and status = 'processing';

      if current_album_count >= max_per_album then
        continue;
      end if;
    end if;

    return query
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
    where pj.id = candidate.id
    returning pj.*;

    return;
  end loop;
end;
$$;

grant execute on function public.claim_next_photo_job(text, integer) to service_role;
