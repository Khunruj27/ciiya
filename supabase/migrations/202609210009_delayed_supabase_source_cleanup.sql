-- Phase 15: delayed cleanup of verified Supabase sources after R2 migration.
-- The default state is non-destructive. Only service_role may claim due rows,
-- and the application must independently re-verify every R2 object before it
-- deletes any Supabase source object.

alter table public.photos
  add column if not exists source_cleanup_status text not null default 'not_applicable',
  add column if not exists source_cleanup_after timestamptz,
  add column if not exists source_cleanup_attempts integer not null default 0,
  add column if not exists source_cleanup_error text,
  add column if not exists source_cleanup_started_at timestamptz,
  add column if not exists source_cleanup_completed_at timestamptz;

alter table public.photos
  drop constraint if exists photos_source_cleanup_status_check,
  drop constraint if exists photos_source_cleanup_attempts_check,
  add constraint photos_source_cleanup_status_check
    check (
      source_cleanup_status in (
        'not_applicable',
        'retained',
        'deleting',
        'completed',
        'failed'
      )
    ) not valid,
  add constraint photos_source_cleanup_attempts_check
    check (source_cleanup_attempts >= 0) not valid;

alter table public.photos
  validate constraint photos_source_cleanup_status_check;

alter table public.photos
  validate constraint photos_source_cleanup_attempts_check;

create index if not exists idx_photos_source_cleanup_claim
  on public.photos (source_cleanup_status, source_cleanup_after, id)
  where storage_provider = 'r2'
    and migration_status = 'completed'
    and source_cleanup_status in ('retained', 'deleting', 'failed');

create or replace function public.schedule_photo_source_cleanup()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.storage_provider = 'r2'
     and new.migration_status = 'completed'
     and coalesce(new.migration_attempts, 0) > 0
     and coalesce(new.source_cleanup_status, 'not_applicable') = 'not_applicable'
  then
    new.source_cleanup_status := 'retained';
    new.source_cleanup_after :=
      coalesce(new.migration_completed_at, now()) + interval '30 days';
    new.source_cleanup_error := null;
    new.source_cleanup_started_at := null;
    new.source_cleanup_completed_at := null;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_schedule_photo_source_cleanup on public.photos;
create trigger trg_schedule_photo_source_cleanup
before insert or update of storage_provider, migration_status, migration_completed_at
on public.photos
for each row execute procedure public.schedule_photo_source_cleanup();

update public.photos
set
  source_cleanup_status = 'retained',
  source_cleanup_after =
    coalesce(migration_completed_at, updated_at, created_at) + interval '30 days',
  source_cleanup_error = null,
  source_cleanup_started_at = null,
  source_cleanup_completed_at = null
where storage_provider = 'r2'
  and migration_status = 'completed'
  and coalesce(migration_attempts, 0) > 0
  and source_cleanup_status = 'not_applicable';

create or replace function public.claim_photo_source_cleanups(
  p_limit integer default 5,
  p_include_failed boolean default false,
  p_recover_stale boolean default false,
  p_stale_after_seconds integer default 3600,
  p_minimum_age_days integer default 30,
  p_photo_id uuid default null
)
returns table (
  photo_id uuid,
  photo_owner_id uuid,
  photo_user_id uuid,
  photo_album_id uuid,
  photo_storage_bucket text,
  photo_storage_version integer,
  photo_migration_status text,
  photo_migration_attempts integer,
  photo_migration_completed_at timestamptz,
  photo_source_cleanup_status text,
  photo_source_cleanup_after timestamptz,
  photo_source_cleanup_attempts integer,
  photo_storage_path text,
  photo_original_path text,
  photo_preview_path text,
  photo_thumbnail_path text,
  photo_sd_path text,
  photo_hd_path text,
  photo_uhd_path text,
  photo_file_size_bytes bigint,
  photo_original_size_bytes bigint,
  photo_preview_size_bytes bigint,
  photo_thumbnail_size_bytes bigint,
  photo_mime_type text
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_limit < 1 or p_limit > 20 then
    raise exception 'p_limit must be between 1 and 20';
  end if;

  if p_stale_after_seconds < 900 or p_stale_after_seconds > 604800 then
    raise exception 'p_stale_after_seconds must be between 900 and 604800';
  end if;

  if p_minimum_age_days < 7 or p_minimum_age_days > 365 then
    raise exception 'p_minimum_age_days must be between 7 and 365';
  end if;

  return query
  with candidates as (
    select p.id
    from public.photos p
    where p.storage_provider = 'r2'
      and p.migration_status = 'completed'
      and coalesce(p.migration_attempts, 0) > 0
      and p.source_cleanup_after is not null
      and p.source_cleanup_after <= now()
      and coalesce(p.migration_completed_at, p.updated_at, p.created_at)
        <= now() - make_interval(days => p_minimum_age_days)
      and (p_photo_id is null or p.id = p_photo_id)
      and coalesce(p.processing_status, '') not in (
        'pending',
        'processing',
        'uploading',
        'finalizing'
      )
      and not exists (
        select 1
        from public.photo_jobs pj
        where pj.photo_id = p.id
          and pj.status in ('pending', 'processing')
      )
      and (
        p.source_cleanup_status = 'retained'
        or (p_include_failed and p.source_cleanup_status = 'failed')
        or (
          p_recover_stale
          and p.source_cleanup_status = 'deleting'
          and coalesce(p.source_cleanup_started_at, p.updated_at, p.created_at)
            < now() - make_interval(secs => p_stale_after_seconds)
        )
      )
    order by p.source_cleanup_after asc, p.id asc
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.photos p
    set
      source_cleanup_status = 'deleting',
      source_cleanup_attempts = coalesce(p.source_cleanup_attempts, 0) + 1,
      source_cleanup_error = null,
      source_cleanup_started_at = now(),
      source_cleanup_completed_at = null,
      updated_at = now()
    from candidates c
    where p.id = c.id
    returning p.*
  )
  select
    c.id,
    c.owner_id,
    c.user_id,
    c.album_id,
    c.storage_bucket,
    c.storage_version,
    c.migration_status,
    c.migration_attempts,
    c.migration_completed_at,
    c.source_cleanup_status,
    c.source_cleanup_after,
    c.source_cleanup_attempts,
    c.storage_path,
    c.original_path,
    c.preview_path,
    c.thumbnail_path,
    c.sd_path,
    c.hd_path,
    c.uhd_path,
    c.file_size_bytes,
    c.original_size_bytes,
    c.preview_size_bytes,
    c.thumbnail_size_bytes,
    c.mime_type
  from claimed c;
end;
$function$;

revoke all on function public.claim_photo_source_cleanups(
  integer,
  boolean,
  boolean,
  integer,
  integer,
  uuid
) from public, anon, authenticated;

grant execute on function public.claim_photo_source_cleanups(
  integer,
  boolean,
  boolean,
  integer,
  integer,
  uuid
) to service_role;
