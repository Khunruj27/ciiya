-- Phase 3 of the Supabase Storage -> Cloudflare R2 migration.
--
-- This migration is deliberately additive. Existing rows continue to resolve
-- through the legacy Supabase bucket rules because storage_bucket remains NULL
-- for them. A legacy photo may have derivatives in `albums` while its original
-- has already been relocated to `originals`, so backfilling one bucket name
-- would be incorrect.

alter table public.photos
  add column if not exists storage_provider text default 'supabase',
  add column if not exists storage_bucket text,
  add column if not exists storage_version integer default 1,
  add column if not exists migration_status text default 'pending';

alter table public.photos
  alter column storage_provider set default 'supabase',
  alter column storage_version set default 1,
  alter column migration_status set default 'pending';

-- Repair a partially applied migration safely before adding NOT NULL and check
-- constraints. An already-R2 row with no migration status is treated as
-- completed because its provider was previously switched explicitly.
update public.photos
set storage_provider = 'supabase'
where storage_provider is null;

update public.photos
set storage_version = 1
where storage_version is null;

update public.photos
set migration_status = case
  when storage_provider = 'r2' then 'completed'
  else 'pending'
end
where migration_status is null;

-- Validate NOT NULL semantics before taking the short metadata lock required by
-- SET NOT NULL. This avoids holding a write-blocking lock during a table scan.
alter table public.photos
  drop constraint if exists photos_storage_provider_not_null_migration,
  drop constraint if exists photos_storage_version_not_null_migration,
  drop constraint if exists photos_migration_status_not_null_migration,
  add constraint photos_storage_provider_not_null_migration
    check (storage_provider is not null) not valid,
  add constraint photos_storage_version_not_null_migration
    check (storage_version is not null) not valid,
  add constraint photos_migration_status_not_null_migration
    check (migration_status is not null) not valid;

alter table public.photos
  validate constraint photos_storage_provider_not_null_migration;
alter table public.photos
  validate constraint photos_storage_version_not_null_migration;
alter table public.photos
  validate constraint photos_migration_status_not_null_migration;

alter table public.photos
  alter column storage_provider set not null,
  alter column storage_version set not null,
  alter column migration_status set not null;

alter table public.photos
  drop constraint photos_storage_provider_not_null_migration,
  drop constraint photos_storage_version_not_null_migration,
  drop constraint photos_migration_status_not_null_migration;

alter table public.photos
  drop constraint if exists photos_storage_provider_check,
  drop constraint if exists photos_storage_version_check,
  drop constraint if exists photos_migration_status_check,
  drop constraint if exists photos_r2_storage_bucket_check,
  add constraint photos_storage_provider_check
    check (storage_provider in ('supabase', 'r2')) not valid,
  add constraint photos_storage_version_check
    check (storage_version >= 1) not valid,
  add constraint photos_migration_status_check
    check (
      migration_status in (
        'pending',
        'copying',
        'verifying',
        'completed',
        'failed'
      )
    ) not valid,
  add constraint photos_r2_storage_bucket_check
    check (
      storage_provider <> 'r2'
      or (
        storage_bucket is not null
        and length(storage_bucket) between 3 and 63
        and storage_bucket ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
        and storage_bucket not like '%..%'
      )
    ) not valid;

alter table public.photos
  validate constraint photos_storage_provider_check;
alter table public.photos
  validate constraint photos_storage_version_check;
alter table public.photos
  validate constraint photos_migration_status_check;
alter table public.photos
  validate constraint photos_r2_storage_bucket_check;

-- Phase 13 will claim only legacy rows that still need migration or retry.
-- Completed rows are intentionally excluded to keep this index compact.
create index if not exists idx_photos_storage_migration_queue
  on public.photos (migration_status, created_at, id)
  where storage_provider = 'supabase'
    and migration_status in ('pending', 'copying', 'verifying', 'failed');

comment on column public.photos.storage_provider is
  'Object storage provider for this photo: supabase or r2.';
comment on column public.photos.storage_bucket is
  'Provider bucket for R2 objects. NULL preserves legacy Supabase per-path bucket resolution.';
comment on column public.photos.storage_version is
  'Storage metadata/key-layout version. Starts at 1.';
comment on column public.photos.migration_status is
  'Supabase-to-R2 copy state: pending, copying, verifying, completed, or failed.';
