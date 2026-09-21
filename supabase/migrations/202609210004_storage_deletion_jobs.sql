-- Phase 8: durable, retryable object deletion across Supabase Storage and R2.
-- Rows are staged before application records are removed. They become pending
-- only after the database deletion succeeds, preventing storage loss when the
-- database transaction fails.

create table if not exists public.storage_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  owner_id uuid not null,
  album_id uuid,
  photo_id uuid,
  storage_provider text not null,
  storage_bucket text not null,
  object_key text not null,
  status text not null default 'staged',
  retry_count integer not null default 0,
  max_retries integer not null default 10,
  worker_id text,
  last_error text,
  next_retry_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint storage_deletion_jobs_provider_check
    check (storage_provider in ('supabase', 'r2')),
  constraint storage_deletion_jobs_status_check
    check (status in ('staged', 'pending', 'processing', 'completed', 'failed')),
  constraint storage_deletion_jobs_retry_check
    check (retry_count >= 0 and max_retries between 1 and 50),
  constraint storage_deletion_jobs_bucket_check
    check (
      length(storage_bucket) between 3 and 63
      and storage_bucket ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
      and storage_bucket not like '%..%'
    ),
  constraint storage_deletion_jobs_object_key_check
    check (
      length(object_key) between 1 and 1024
      and object_key not like '/%'
      and object_key not like '%..%'
      and position(chr(92) in object_key) = 0
      and object_key not like '%//%'
    ),
  constraint storage_deletion_jobs_object_unique
    unique (operation_id, storage_provider, storage_bucket, object_key)
);

create index if not exists idx_storage_deletion_jobs_ready
  on public.storage_deletion_jobs (status, next_retry_at, created_at)
  where status in ('pending', 'failed');

create index if not exists idx_storage_deletion_jobs_operation
  on public.storage_deletion_jobs (operation_id, status);

create index if not exists idx_storage_deletion_jobs_recovery
  on public.storage_deletion_jobs (status, updated_at)
  where status in ('staged', 'processing');

alter table public.storage_deletion_jobs enable row level security;

revoke all on table public.storage_deletion_jobs from anon, authenticated;
grant all on table public.storage_deletion_jobs to service_role;

create or replace function public.claim_storage_deletion_jobs(
  p_worker_id text,
  p_limit integer default 100,
  p_operation_id uuid default null
)
returns setof public.storage_deletion_jobs
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'p_worker_id is required';
  end if;

  return query
  with claimable as (
    select j.id
    from public.storage_deletion_jobs j
    where j.status in ('pending', 'failed')
      and j.retry_count < j.max_retries
      and (j.next_retry_at is null or j.next_retry_at <= now())
      and (p_operation_id is null or j.operation_id = p_operation_id)
    order by j.created_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  )
  update public.storage_deletion_jobs j
  set status = 'processing',
      worker_id = p_worker_id,
      started_at = now(),
      updated_at = now()
  from claimable c
  where j.id = c.id
  returning j.*;
end;
$function$;

revoke all
on function public.claim_storage_deletion_jobs(text, integer, uuid)
from public, anon, authenticated;

grant execute
on function public.claim_storage_deletion_jobs(text, integer, uuid)
to service_role;

create or replace function public.recover_staged_storage_deletion_jobs(
  p_stale_before timestamptz default now() - interval '10 minutes',
  p_limit integer default 500
)
returns table(activated integer, discarded integer, requeued integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_activated integer := 0;
  v_discarded integer := 0;
  v_requeued integer := 0;
begin
  with interrupted as (
    select j.id
    from public.storage_deletion_jobs j
    where j.status = 'processing'
      and j.updated_at < p_stale_before
      and j.retry_count < j.max_retries
    order by j.updated_at asc
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
    for update skip locked
  )
  update public.storage_deletion_jobs j
  set status = 'failed',
      retry_count = least(j.max_retries, j.retry_count + 1),
      worker_id = null,
      last_error = 'Recovered after interrupted storage deletion',
      next_retry_at = now(),
      updated_at = now()
  from interrupted i
  where j.id = i.id;

  get diagnostics v_requeued = row_count;

  with candidates as (
    select j.id
    from public.storage_deletion_jobs j
    where j.status = 'staged'
      and j.updated_at < p_stale_before
      and (
        (j.photo_id is not null and not exists (
          select 1 from public.photos p where p.id = j.photo_id
        ))
        or
        (j.photo_id is null and j.album_id is not null and not exists (
          select 1 from public.albums a where a.id = j.album_id
        ))
      )
    order by j.created_at asc
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
    for update skip locked
  )
  update public.storage_deletion_jobs j
  set status = 'pending',
      next_retry_at = null,
      last_error = 'Recovered after database deletion',
      updated_at = now()
  from candidates c
  where j.id = c.id;

  get diagnostics v_activated = row_count;

  with abandoned as (
    select j.id
    from public.storage_deletion_jobs j
    where j.status = 'staged'
      and j.updated_at < now() - interval '24 hours'
      and (
        (j.photo_id is not null and exists (
          select 1 from public.photos p where p.id = j.photo_id
        ))
        or
        (j.photo_id is null and j.album_id is not null and exists (
          select 1 from public.albums a where a.id = j.album_id
        ))
      )
    order by j.created_at asc
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
    for update skip locked
  )
  delete from public.storage_deletion_jobs j
  using abandoned a
  where j.id = a.id;

  get diagnostics v_discarded = row_count;

  return query select v_activated, v_discarded, v_requeued;
end;
$function$;

revoke all
on function public.recover_staged_storage_deletion_jobs(timestamptz, integer)
from public, anon, authenticated;

grant execute
on function public.recover_staged_storage_deletion_jobs(timestamptz, integer)
to service_role;
