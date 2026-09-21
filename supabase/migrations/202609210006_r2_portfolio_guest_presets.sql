-- Phase 10: provider-neutral storage metadata for Portfolio images,
-- Guest Moments, and private XMP presets. Existing URL/path columns stay in
-- place so every Supabase object remains readable during the dual-provider
-- migration.

create table if not exists public.storage_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  album_id uuid references public.albums(id) on delete cascade,
  asset_kind text not null,
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  object_key text not null,
  public_url text,
  original_name text,
  content_type text not null,
  size_bytes bigint not null,
  status text not null default 'uploading',
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storage_assets_kind_check
    check (asset_kind in ('portfolio', 'guest_moment', 'preset')),
  constraint storage_assets_provider_check
    check (storage_provider in ('supabase', 'r2')),
  constraint storage_assets_status_check
    check (status in ('uploading', 'active', 'failed', 'deleting')),
  constraint storage_assets_size_check
    check (size_bytes > 0),
  constraint storage_assets_object_unique
    unique (storage_provider, storage_bucket, object_key)
);

create index if not exists idx_storage_assets_owner_kind_created
  on public.storage_assets(owner_id, asset_kind, created_at desc);

create index if not exists idx_storage_assets_album_kind_created
  on public.storage_assets(album_id, asset_kind, created_at desc)
  where album_id is not null;

create index if not exists idx_storage_assets_expiry
  on public.storage_assets(expires_at)
  where status = 'uploading';

drop trigger if exists trg_storage_assets_updated_at
  on public.storage_assets;
create trigger trg_storage_assets_updated_at
before update on public.storage_assets
for each row execute procedure public.set_updated_at();

alter table public.storage_assets enable row level security;

drop policy if exists "storage_assets_select_own"
  on public.storage_assets;
create policy "storage_assets_select_own"
on public.storage_assets for select to authenticated
using (auth.uid() = owner_id);

revoke insert, update, delete on table public.storage_assets
  from anon, authenticated;
grant select on table public.storage_assets to authenticated;

alter table public.portfolios
  add column if not exists storage_asset_ids uuid[] not null default '{}';

alter table public.portfolios
  drop constraint if exists portfolios_storage_asset_count;
alter table public.portfolios
  add constraint portfolios_storage_asset_count
  check (
    array_length(storage_asset_ids, 1) is null
    or array_length(storage_asset_ids, 1) <= 25
  );

alter table public.guest_moments
  add column if not exists storage_asset_ids uuid[] not null default '{}';

alter table public.guest_moments
  drop constraint if exists guest_moments_storage_asset_count;
alter table public.guest_moments
  add constraint guest_moments_storage_asset_count
  check (
    array_length(storage_asset_ids, 1) is null
    or array_length(storage_asset_ids, 1) <= 4
  );

-- storage_assets does not replace user_storage_usage. This trigger feeds the
-- existing quota row with non-photo object bytes, including a short-lived
-- reservation while a signed Portfolio upload is in flight.
create or replace function public.update_storage_after_asset_change()
returns trigger
language plpgsql
as $$
declare
  old_owner uuid;
  new_owner uuid;
  old_charge bigint := 0;
  new_charge bigint := 0;
begin
  if tg_op <> 'INSERT' then
    old_owner := old.owner_id;
    if old.status in ('uploading', 'active', 'deleting') then
      old_charge := old.size_bytes;
    end if;
  end if;

  if tg_op <> 'DELETE' then
    new_owner := new.owner_id;
    if new.status in ('uploading', 'active', 'deleting') then
      new_charge := new.size_bytes;
    end if;
  end if;

  if old_owner is not null and (new_owner is null or old_owner <> new_owner) then
    update public.user_storage_usage
    set
      used_bytes = greatest(0, used_bytes - old_charge),
      storage_used_bytes = greatest(0, storage_used_bytes - old_charge),
      updated_at = now()
    where user_id = old_owner;
    old_charge := 0;
  end if;

  if new_owner is not null and (old_owner is null or old_owner <> new_owner) then
    insert into public.user_storage_usage (
      user_id,
      used_bytes,
      storage_used_bytes,
      updated_at
    )
    values (new_owner, new_charge, new_charge, now())
    on conflict (user_id)
    do update set
      used_bytes = public.user_storage_usage.used_bytes + new_charge,
      storage_used_bytes = public.user_storage_usage.storage_used_bytes + new_charge,
      updated_at = now();
  elsif new_owner is not null and new_charge <> old_charge then
    update public.user_storage_usage
    set
      used_bytes = greatest(0, used_bytes + new_charge - old_charge),
      storage_used_bytes = greatest(
        0,
        storage_used_bytes + new_charge - old_charge
      ),
      updated_at = now()
    where user_id = new_owner;
  elsif tg_op = 'DELETE' and old_owner is not null and old_charge > 0 then
    update public.user_storage_usage
    set
      used_bytes = greatest(0, used_bytes - old_charge),
      storage_used_bytes = greatest(0, storage_used_bytes - old_charge),
      updated_at = now()
    where user_id = old_owner;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_storage_asset_usage
  on public.storage_assets;
create trigger trg_storage_asset_usage
after insert or update of owner_id, size_bytes, status or delete
on public.storage_assets
for each row execute procedure public.update_storage_after_asset_change();

create or replace function public.recalculate_user_storage(user_uuid uuid)
returns void
language plpgsql
as $$
declare
  total_used bigint;
  total_photos integer;
  total_albums integer;
begin
  select
    coalesce(sum(p.file_size_bytes), 0)
      + coalesce((
          select sum(sa.size_bytes)
          from public.storage_assets sa
          where sa.owner_id = user_uuid
            and sa.status in ('uploading', 'active', 'deleting')
        ), 0),
    count(*)
  into total_used, total_photos
  from public.photos p
  where coalesce(p.owner_id, p.user_id) = user_uuid;

  select count(*)
  into total_albums
  from public.albums
  where coalesce(owner_id, user_id) = user_uuid;

  insert into public.user_storage_usage (
    user_id,
    used_bytes,
    storage_used_bytes,
    photo_count,
    photos_count,
    albums_count,
    updated_at
  )
  values (
    user_uuid,
    total_used,
    total_used,
    total_photos,
    total_photos,
    total_albums,
    now()
  )
  on conflict (user_id)
  do update set
    used_bytes = excluded.used_bytes,
    storage_used_bytes = excluded.storage_used_bytes,
    photo_count = excluded.photo_count,
    photos_count = excluded.photos_count,
    albums_count = excluded.albums_count,
    updated_at = now();
end;
$$;
