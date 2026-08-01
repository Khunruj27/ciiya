alter table public.photo_jobs
  add column if not exists claimed_by text;

alter table public.face_jobs
  add column if not exists worker_id text,
  add column if not exists claimed_by text;

create index if not exists idx_photo_jobs_claim_ready
  on public.photo_jobs(status, priority, created_at)
  where status = 'pending';

create index if not exists idx_face_jobs_claim_ready
  on public.face_jobs(status, priority, created_at)
  where status = 'pending';

create index if not exists idx_photo_jobs_photo_processing
  on public.photo_jobs(photo_id, status)
  where status = 'processing';

create index if not exists idx_face_jobs_photo_processing
  on public.face_jobs(photo_id, status)
  where status = 'processing';

create or replace function public.claim_next_photo_job(worker_name text)
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

create or replace function public.claim_next_face_job(worker_name text)
returns setof public.face_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with selected_job as (
    select fj.id
    from public.face_jobs fj
    where fj.status = 'pending'
      and not exists (
        select 1
        from public.face_jobs active
        where active.photo_id = fj.photo_id
          and active.id <> fj.id
          and active.status = 'processing'
      )
    order by fj.priority asc, fj.created_at asc
    limit 1
    for update skip locked
  ), claimed_job as (
    update public.face_jobs fj
    set
      status = 'processing',
      progress = 5,
      started_at = now(),
      finished_at = null,
      error = null,
      worker_id = worker_name,
      claimed_by = worker_name,
      updated_at = now()
    where fj.id in (select selected_job.id from selected_job)
    returning fj.*
  )
  select * from claimed_job;
end;
$$;

grant execute on function public.claim_next_photo_job(text) to service_role;
grant execute on function public.claim_next_face_job(text) to service_role;