-- Phase 11: provider-aware consistency observations. Cleanup remains a
-- separate, explicit phase and dry-run is enforced by application code.

create table if not exists public.storage_consistency_issues (
  id uuid primary key default gen_random_uuid(),
  issue_type text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  album_id uuid references public.albums(id) on delete cascade,
  photo_id uuid references public.photos(id) on delete cascade,
  storage_provider text not null default 'supabase',
  bucket text not null default 'albums',
  storage_path text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storage_consistency_provider_check
    check (storage_provider in ('supabase', 'r2')),
  constraint storage_consistency_status_check
    check (status in ('open', 'resolved', 'ignored')),
  constraint storage_consistency_severity_check
    check (severity in ('info', 'warning', 'high', 'critical'))
);

alter table public.storage_consistency_issues
  add column if not exists storage_provider text not null default 'supabase';
alter table public.storage_consistency_issues
  add column if not exists bucket text not null default 'albums';
alter table public.storage_consistency_issues
  add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.storage_consistency_issues
  add column if not exists detected_at timestamptz not null default now();
alter table public.storage_consistency_issues
  add column if not exists resolved_at timestamptz;
alter table public.storage_consistency_issues
  add column if not exists created_at timestamptz not null default now();
alter table public.storage_consistency_issues
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_storage_consistency_open_object
  on public.storage_consistency_issues (
    status,
    storage_provider,
    bucket,
    storage_path
  )
  where status = 'open';

create index if not exists idx_storage_consistency_owner_detected
  on public.storage_consistency_issues (owner_id, detected_at desc);

create index if not exists idx_storage_assets_cleanup_expiry
  on public.storage_assets (status, expires_at)
  where status in ('uploading', 'failed') and expires_at is not null;

drop trigger if exists trg_storage_consistency_issues_updated_at
  on public.storage_consistency_issues;
create trigger trg_storage_consistency_issues_updated_at
before update on public.storage_consistency_issues
for each row execute procedure public.set_updated_at();

alter table public.storage_consistency_issues enable row level security;
revoke all on table public.storage_consistency_issues from anon, authenticated;
grant all on table public.storage_consistency_issues to service_role;

create or replace function public.cleanup_storage_consistency_issues(
  keep_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  deleted_count integer := 0;
begin
  if keep_days < 1 then
    raise exception 'keep_days must be positive';
  end if;

  delete from public.storage_consistency_issues
  where status in ('resolved', 'ignored')
    and coalesce(resolved_at, updated_at, detected_at)
      < now() - make_interval(days => keep_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

revoke all on function public.cleanup_storage_consistency_issues(integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_storage_consistency_issues(integer)
  to service_role;
