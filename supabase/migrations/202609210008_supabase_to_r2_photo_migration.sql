-- Phase 13: retryable, service-role-only photo copy claims.
-- This migration never deletes a Supabase object. The application switches a
-- row to R2 only after every referenced object passes a second HEAD check.

alter table public.photos
  add column if not exists migration_attempts integer not null default 0,
  add column if not exists migration_error text,
  add column if not exists migration_started_at timestamptz,
  add column if not exists migration_completed_at timestamptz;

alter table public.photos
  drop constraint if exists photos_migration_attempts_check,
  add constraint photos_migration_attempts_check
    check (migration_attempts >= 0) not valid;

alter table public.photos
  validate constraint photos_migration_attempts_check;

create index if not exists idx_photos_storage_migration_recovery
  on public.photos (migration_status, migration_started_at, created_at, id)
  where storage_provider = 'supabase'
    and migration_status in ('copying', 'verifying', 'failed');

create or replace function public.claim_photo_storage_migrations(
  p_limit integer default 5,
  p_include_failed boolean default false,
  p_recover_stale boolean default false,
  p_stale_after_seconds integer default 3600,
  p_photo_id uuid default null
)
returns table (
  photo_id uuid,
  photo_owner_id uuid,
  photo_user_id uuid,
  photo_album_id uuid,
  photo_storage_version integer,
  photo_migration_status text,
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
  if p_limit < 1 or p_limit > 50 then
    raise exception 'p_limit must be between 1 and 50';
  end if;

  if p_stale_after_seconds < 300 or p_stale_after_seconds > 604800 then
    raise exception 'p_stale_after_seconds must be between 300 and 604800';
  end if;

  return query
  with candidates as (
    select p.id
    from public.photos p
    where p.storage_provider = 'supabase'
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
        p.migration_status = 'pending'
        or (p_include_failed and p.migration_status = 'failed')
        or (
          p_recover_stale
          and p.migration_status in ('copying', 'verifying')
          and coalesce(p.migration_started_at, p.updated_at, p.created_at)
            < now() - make_interval(secs => p_stale_after_seconds)
        )
      )
    order by p.created_at asc, p.id asc
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.photos p
    set
      migration_status = 'copying',
      migration_attempts = coalesce(p.migration_attempts, 0) + 1,
      migration_error = null,
      migration_started_at = now(),
      migration_completed_at = null,
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
    c.storage_version,
    c.migration_status,
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

revoke all on function public.claim_photo_storage_migrations(
  integer,
  boolean,
  boolean,
  integer,
  uuid
) from public, anon, authenticated;

grant execute on function public.claim_photo_storage_migrations(
  integer,
  boolean,
  boolean,
  integer,
  uuid
) to service_role;
