-- Phase 14.5.1: Ciiya Sync device pairing foundation.
--
-- Ciiya Sync is a local Lightroom companion. It receives a short-lived
-- pairing code, is approved by the signed-in owner, and exchanges the pairing
-- for a revocable device token. Only token hashes are stored in PostgreSQL.
-- Existing Browser Upload, Camera Live Import, Photo Worker, Face Worker, and
-- storage-provider behavior remain unchanged by this migration.

create table if not exists public.ciiya_sync_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_device_id uuid not null,
  name text not null,
  platform text not null default 'unknown',
  app_version text,
  token_hash text not null unique,
  token_expires_at timestamptz not null,
  scopes text[] not null default array[
    'albums:read',
    'photos:upload',
    'sync:write'
  ]::text[],
  last_seen_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ciiya_sync_devices_owner_client_unique
    unique (owner_id, client_device_id),
  constraint ciiya_sync_devices_name_check
    check (length(btrim(name)) between 1 and 80),
  constraint ciiya_sync_devices_platform_check
    check (platform in ('macos', 'windows', 'linux', 'unknown')),
  constraint ciiya_sync_devices_token_hash_check
    check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint ciiya_sync_devices_token_expiry_check
    check (token_expires_at > created_at),
  constraint ciiya_sync_devices_scopes_check
    check (
      scopes <@ array[
        'albums:read',
        'photos:upload',
        'sync:write'
      ]::text[]
      and cardinality(scopes) > 0
    )
);

create index if not exists idx_ciiya_sync_devices_owner_active
  on public.ciiya_sync_devices (owner_id, updated_at desc)
  where revoked_at is null;

create index if not exists idx_ciiya_sync_devices_active_token
  on public.ciiya_sync_devices (token_hash)
  where revoked_at is null;

drop trigger if exists trg_ciiya_sync_devices_updated_at
  on public.ciiya_sync_devices;
create trigger trg_ciiya_sync_devices_updated_at
before update on public.ciiya_sync_devices
for each row execute procedure public.set_updated_at();

create table if not exists public.ciiya_sync_pairings (
  id uuid primary key default gen_random_uuid(),
  client_device_id uuid not null,
  device_id uuid references public.ciiya_sync_devices(id) on delete set null,
  owner_id uuid references auth.users(id) on delete cascade,
  user_code_hash text not null unique,
  poll_secret_hash text not null,
  device_name text not null,
  platform text not null default 'unknown',
  app_version text,
  status text not null default 'pending',
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ciiya_sync_pairings_name_check
    check (length(btrim(device_name)) between 1 and 80),
  constraint ciiya_sync_pairings_platform_check
    check (platform in ('macos', 'windows', 'linux', 'unknown')),
  constraint ciiya_sync_pairings_status_check
    check (status in ('pending', 'approved', 'consumed', 'expired', 'denied')),
  constraint ciiya_sync_pairings_code_hash_check
    check (user_code_hash ~ '^[a-f0-9]{64}$'),
  constraint ciiya_sync_pairings_poll_hash_check
    check (poll_secret_hash ~ '^[a-f0-9]{64}$'),
  constraint ciiya_sync_pairings_expiry_check
    check (expires_at > created_at)
);

create index if not exists idx_ciiya_sync_pairings_status_expiry
  on public.ciiya_sync_pairings (status, expires_at);

create index if not exists idx_ciiya_sync_pairings_client_created
  on public.ciiya_sync_pairings (client_device_id, created_at desc);

drop trigger if exists trg_ciiya_sync_pairings_updated_at
  on public.ciiya_sync_pairings;
create trigger trg_ciiya_sync_pairings_updated_at
before update on public.ciiya_sync_pairings
for each row execute procedure public.set_updated_at();

alter table public.ciiya_sync_devices enable row level security;
alter table public.ciiya_sync_pairings enable row level security;

drop policy if exists "ciiya_sync_devices_select_own"
  on public.ciiya_sync_devices;
create policy "ciiya_sync_devices_select_own"
on public.ciiya_sync_devices for select
to authenticated
using (owner_id = auth.uid());

revoke all on table public.ciiya_sync_devices from anon, authenticated;
grant select on table public.ciiya_sync_devices to authenticated;
grant all on table public.ciiya_sync_devices to service_role;

revoke all on table public.ciiya_sync_pairings from anon, authenticated;
grant all on table public.ciiya_sync_pairings to service_role;

create or replace function public.approve_ciiya_sync_pairing(
  p_user_code_hash text,
  p_owner_id uuid
)
returns table (
  pairing_id uuid,
  pairing_status text,
  device_name text,
  device_platform text,
  pairing_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pairing public.ciiya_sync_pairings%rowtype;
begin
  if p_user_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_PAIRING_CODE';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_owner_id) then
    raise exception using errcode = 'P0001', message = 'OWNER_NOT_FOUND';
  end if;

  select p.* into v_pairing
  from public.ciiya_sync_pairings p
  where p.user_code_hash = p_user_code_hash
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PAIRING_NOT_FOUND';
  end if;

  if v_pairing.expires_at <= now() then
    update public.ciiya_sync_pairings p
    set status = 'expired'
    where p.id = v_pairing.id
      and p.status in ('pending', 'approved');

    return query select
      v_pairing.id,
      'expired'::text,
      v_pairing.device_name,
      v_pairing.platform,
      v_pairing.expires_at;
    return;
  end if;

  if v_pairing.status = 'pending' then
    update public.ciiya_sync_pairings p
    set owner_id = p_owner_id,
        status = 'approved',
        approved_at = now()
    where p.id = v_pairing.id;
  elsif v_pairing.status = 'approved' and v_pairing.owner_id <> p_owner_id then
    raise exception using errcode = 'P0001', message = 'PAIRING_ALREADY_APPROVED';
  elsif v_pairing.status <> 'approved' then
    raise exception using errcode = 'P0001', message = 'PAIRING_NOT_PENDING';
  end if;

  return query select
    v_pairing.id,
    'approved'::text,
    v_pairing.device_name,
    v_pairing.platform,
    v_pairing.expires_at;
end;
$function$;

revoke all
on function public.approve_ciiya_sync_pairing(text, uuid)
from public, anon, authenticated;
grant execute
on function public.approve_ciiya_sync_pairing(text, uuid)
to service_role;

create or replace function public.consume_ciiya_sync_pairing(
  p_pairing_id uuid,
  p_poll_secret_hash text,
  p_token_hash text,
  p_token_expires_at timestamptz
)
returns table (
  pairing_status text,
  paired_device_id uuid,
  paired_owner_id uuid,
  token_issued boolean
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pairing public.ciiya_sync_pairings%rowtype;
  v_device_id uuid;
begin
  if p_poll_secret_hash !~ '^[a-f0-9]{64}$'
    or p_token_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = 'P0001', message = 'INVALID_PAIRING_SECRET';
  end if;

  if p_token_expires_at <= now() + interval '1 day'
    or p_token_expires_at > now() + interval '100 days'
  then
    raise exception using errcode = 'P0001', message = 'INVALID_TOKEN_EXPIRY';
  end if;

  select p.* into v_pairing
  from public.ciiya_sync_pairings p
  where p.id = p_pairing_id
    and p.poll_secret_hash = p_poll_secret_hash
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PAIRING_NOT_FOUND';
  end if;

  if v_pairing.expires_at <= now()
    and v_pairing.status in ('pending', 'approved')
  then
    update public.ciiya_sync_pairings p
    set status = 'expired'
    where p.id = v_pairing.id;

    return query select 'expired'::text, null::uuid, null::uuid, false;
    return;
  end if;

  if v_pairing.status = 'pending' then
    return query select 'pending'::text, null::uuid, null::uuid, false;
    return;
  end if;

  if v_pairing.status = 'consumed' then
    return query select
      'consumed'::text,
      v_pairing.device_id,
      v_pairing.owner_id,
      false;
    return;
  end if;

  if v_pairing.status <> 'approved' or v_pairing.owner_id is null then
    return query select v_pairing.status, null::uuid, v_pairing.owner_id, false;
    return;
  end if;

  insert into public.ciiya_sync_devices as d (
    owner_id,
    client_device_id,
    name,
    platform,
    app_version,
    token_hash,
    token_expires_at,
    scopes,
    last_seen_at,
    revoked_at
  ) values (
    v_pairing.owner_id,
    v_pairing.client_device_id,
    v_pairing.device_name,
    v_pairing.platform,
    v_pairing.app_version,
    p_token_hash,
    p_token_expires_at,
    array['albums:read', 'photos:upload', 'sync:write']::text[],
    now(),
    null
  )
  on conflict (owner_id, client_device_id) do update
  set name = excluded.name,
      platform = excluded.platform,
      app_version = excluded.app_version,
      token_hash = excluded.token_hash,
      token_expires_at = excluded.token_expires_at,
      scopes = excluded.scopes,
      last_seen_at = now(),
      revoked_at = null
  returning d.id into v_device_id;

  update public.ciiya_sync_pairings p
  set device_id = v_device_id,
      status = 'consumed',
      consumed_at = now()
  where p.id = v_pairing.id;

  return query select
    'consumed'::text,
    v_device_id,
    v_pairing.owner_id,
    true;
end;
$function$;

revoke all
on function public.consume_ciiya_sync_pairing(uuid, text, text, timestamptz)
from public, anon, authenticated;
grant execute
on function public.consume_ciiya_sync_pairing(uuid, text, text, timestamptz)
to service_role;
