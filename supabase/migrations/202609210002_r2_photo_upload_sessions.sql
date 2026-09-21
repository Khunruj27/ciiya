-- Phase 4: short-lived, authenticated reservations for browser -> R2 uploads.
-- The table does not replace user_storage_usage. It only reserves estimated
-- bytes while a signed PUT is outstanding so concurrent requests cannot each
-- pass the same remaining-quota check.

create table if not exists public.photo_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  client_upload_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  album_id uuid not null references public.albums(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  photo_id uuid references public.photos(id) on delete set null,

  storage_provider text not null default 'r2',
  storage_bucket text not null,
  object_key text not null,

  original_file_name text not null,
  content_type text not null,
  expected_size_bytes bigint not null,
  reserved_bytes bigint not null,
  file_hash text not null,
  requested_size text not null default 'original',
  preset_path text,
  auto_face_scan boolean not null default true,
  auto_publish boolean not null default false,

  status text not null default 'issued',
  error text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint photo_upload_sessions_provider_check
    check (storage_provider = 'r2'),
  constraint photo_upload_sessions_status_check
    check (
      status in (
        'issued',
        'uploading',
        'finalizing',
        'completed',
        'failed',
        'cancelled',
        'expired'
      )
    ),
  constraint photo_upload_sessions_content_type_check
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint photo_upload_sessions_size_check
    check (expected_size_bytes between 1 and 209715200),
  constraint photo_upload_sessions_reserved_size_check
    check (reserved_bytes >= expected_size_bytes),
  constraint photo_upload_sessions_requested_size_check
    check (requested_size in ('sd', 'hd', 'uhd', 'original')),
  constraint photo_upload_sessions_hash_check
    check (file_hash ~ '^[a-f0-9]{64}$'),
  constraint photo_upload_sessions_bucket_check
    check (
      length(storage_bucket) between 3 and 63
      and storage_bucket ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
      and storage_bucket not like '%..%'
    ),
  constraint photo_upload_sessions_owner_client_unique
    unique (owner_id, client_upload_id),
  constraint photo_upload_sessions_object_unique
    unique (storage_provider, storage_bucket, object_key)
);

create index if not exists idx_photo_upload_sessions_owner_active
  on public.photo_upload_sessions (owner_id, status, expires_at);
create index if not exists idx_photo_upload_sessions_album_created
  on public.photo_upload_sessions (album_id, created_at desc);
create index if not exists idx_photo_upload_sessions_expiry
  on public.photo_upload_sessions (expires_at)
  where status in ('issued', 'uploading', 'finalizing');

drop trigger if exists trg_photo_upload_sessions_updated_at
  on public.photo_upload_sessions;
create trigger trg_photo_upload_sessions_updated_at
before update on public.photo_upload_sessions
for each row execute procedure public.set_updated_at();

alter table public.photo_upload_sessions enable row level security;

drop policy if exists "photo_upload_sessions_select_own"
  on public.photo_upload_sessions;
create policy "photo_upload_sessions_select_own"
on public.photo_upload_sessions for select
to authenticated
using (auth.uid() = owner_id);

revoke insert, update, delete on table public.photo_upload_sessions
  from anon, authenticated;
grant select on table public.photo_upload_sessions to authenticated;

create or replace function public.reserve_photo_upload(
  p_album_id uuid,
  p_client_upload_id uuid,
  p_storage_bucket text,
  p_object_key text,
  p_original_file_name text,
  p_content_type text,
  p_expected_size_bytes bigint,
  p_file_hash text,
  p_requested_size text,
  p_category_id uuid default null,
  p_preset_path text default null,
  p_auto_face_scan boolean default true,
  p_auto_publish boolean default false
)
returns table (
  session_id uuid,
  reserved_object_key text,
  reserved_storage_bucket text,
  reserved_size_bytes bigint,
  remaining_bytes bigint,
  session_expires_at timestamptz,
  reused boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.photo_upload_sessions%rowtype;
  v_session public.photo_upload_sessions%rowtype;
  v_used_bytes bigint := 0;
  v_limit_bytes bigint := 5368709120;
  v_active_reserved bigint := 0;
  v_reserved_bytes bigint;
  v_expected_prefix text;
  v_expected_album_preset_prefix text;
  v_expected_user_preset_prefix text;
  v_object_name text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  -- Serialize quota reservations per user without blocking other accounts.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if not exists (
    select 1
    from public.albums a
    where a.id = p_album_id
      and (a.owner_id = v_user_id or a.user_id = v_user_id)
  ) then
    raise exception using errcode = 'P0001', message = 'ALBUM_NOT_FOUND';
  end if;

  if p_category_id is not null and not exists (
    select 1
    from public.categories c
    where c.id = p_category_id
      and c.album_id = p_album_id
  ) then
    raise exception using errcode = 'P0001', message = 'CATEGORY_NOT_FOUND';
  end if;

  if p_expected_size_bytes < 1 or p_expected_size_bytes > 209715200 then
    raise exception using errcode = 'P0001', message = 'INVALID_UPLOAD_SIZE';
  end if;

  if p_content_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_TYPE';
  end if;

  if p_requested_size not in ('sd', 'hd', 'uhd', 'original') then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUESTED_SIZE';
  end if;

  if p_file_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_FILE_HASH';
  end if;

  if p_original_file_name = '' or length(p_original_file_name) > 255 then
    raise exception using errcode = 'P0001', message = 'INVALID_FILE_NAME';
  end if;

  if length(p_storage_bucket) not between 3 and 63
    or p_storage_bucket !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    or p_storage_bucket like '%..%'
  then
    raise exception using errcode = 'P0001', message = 'INVALID_STORAGE_BUCKET';
  end if;

  v_expected_prefix := v_user_id::text || '/' || p_album_id::text || '/original/';
  v_expected_album_preset_prefix :=
    v_user_id::text || '/' || p_album_id::text || '/presets/';
  v_expected_user_preset_prefix := v_user_id::text || '/presets/';
  v_object_name := substring(p_object_key from length(v_expected_prefix) + 1);

  if p_object_key not like v_expected_prefix || '%'
    or p_object_key like '%..%'
    or position(chr(92) in p_object_key) > 0
    or p_object_key like '%//%'
    or length(p_object_key) > 1024
  then
    raise exception using errcode = 'P0001', message = 'INVALID_OBJECT_KEY';
  end if;

  if v_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
    or (p_content_type = 'image/jpeg' and v_object_name !~ '\.jpg$')
    or (p_content_type = 'image/png' and v_object_name !~ '\.png$')
    or (p_content_type = 'image/webp' and v_object_name !~ '\.webp$')
  then
    raise exception using errcode = 'P0001', message = 'INVALID_OBJECT_KEY';
  end if;

  if p_preset_path is not null and (
    (
      p_preset_path not like v_expected_album_preset_prefix || '%'
      and p_preset_path not like v_expected_user_preset_prefix || '%'
    )
    or p_preset_path not like '%.xmp'
    or p_preset_path like '%..%'
    or position(chr(92) in p_preset_path) > 0
    or p_preset_path like '%//%'
    or lower(p_preset_path) like '%2e%'
    or lower(p_preset_path) like '%2f%'
    or lower(p_preset_path) like '%5c%'
    or length(p_preset_path) > 500
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_PRESET_PATH';
  end if;

  update public.photo_upload_sessions s
  set status = 'expired',
      error = coalesce(s.error, 'Signed upload session expired')
  where s.owner_id = v_user_id
    and s.status in ('issued', 'uploading', 'finalizing')
    and s.expires_at <= now();

  select s.*
  into v_existing
  from public.photo_upload_sessions s
  where s.owner_id = v_user_id
    and s.client_upload_id = p_client_upload_id
  for update;

  if found
    and v_existing.status in ('issued', 'uploading', 'finalizing')
    and v_existing.expires_at > now()
  then
    if v_existing.album_id <> p_album_id
      or v_existing.original_file_name <> p_original_file_name
      or v_existing.content_type <> p_content_type
      or v_existing.expected_size_bytes <> p_expected_size_bytes
      or v_existing.file_hash <> p_file_hash
    then
      raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_CONFLICT';
    end if;

    return query
      select
        v_existing.id,
        v_existing.object_key,
        v_existing.storage_bucket,
        v_existing.reserved_bytes,
        greatest(
          0,
          coalesce(
            (
              select u.storage_limit_bytes -
                coalesce(u.storage_used_bytes, u.used_bytes, 0)
              from public.user_storage_usage u
              where u.user_id = v_user_id
            ),
            5368709120
          )
        ),
        v_existing.expires_at,
        true;
    return;
  end if;

  select
    coalesce(u.storage_used_bytes, u.used_bytes, 0),
    u.storage_limit_bytes
  into v_used_bytes, v_limit_bytes
  from public.user_storage_usage u
  where u.user_id = v_user_id;

  if not found then
    v_used_bytes := 0;
    v_limit_bytes := 5368709120;
  end if;

  select coalesce(sum(s.reserved_bytes), 0)
  into v_active_reserved
  from public.photo_upload_sessions s
  where s.owner_id = v_user_id
    and s.status in ('issued', 'uploading', 'finalizing')
    and s.expires_at > now();

  v_reserved_bytes :=
    p_expected_size_bytes +
    round(p_expected_size_bytes::numeric * 0.35)::bigint +
    round(p_expected_size_bytes::numeric * 0.05)::bigint;

  if v_used_bytes + v_active_reserved + v_reserved_bytes > v_limit_bytes then
    raise exception using errcode = 'P0001', message = 'STORAGE_LIMIT_EXCEEDED';
  end if;

  if v_existing.id is null then
    insert into public.photo_upload_sessions (
      client_upload_id,
      owner_id,
      album_id,
      category_id,
      storage_provider,
      storage_bucket,
      object_key,
      original_file_name,
      content_type,
      expected_size_bytes,
      reserved_bytes,
      file_hash,
      requested_size,
      preset_path,
      auto_face_scan,
      auto_publish,
      status,
      error,
      expires_at
    )
    values (
      p_client_upload_id,
      v_user_id,
      p_album_id,
      p_category_id,
      'r2',
      p_storage_bucket,
      p_object_key,
      p_original_file_name,
      p_content_type,
      p_expected_size_bytes,
      v_reserved_bytes,
      p_file_hash,
      p_requested_size,
      p_preset_path,
      p_auto_face_scan,
      p_auto_publish,
      'issued',
      null,
      now() + interval '15 minutes'
    )
    returning * into v_session;
  else
    update public.photo_upload_sessions s
    set album_id = p_album_id,
        category_id = p_category_id,
        photo_id = null,
        storage_provider = 'r2',
        storage_bucket = p_storage_bucket,
        object_key = p_object_key,
        original_file_name = p_original_file_name,
        content_type = p_content_type,
        expected_size_bytes = p_expected_size_bytes,
        reserved_bytes = v_reserved_bytes,
        file_hash = p_file_hash,
        requested_size = p_requested_size,
        preset_path = p_preset_path,
        auto_face_scan = p_auto_face_scan,
        auto_publish = p_auto_publish,
        status = 'issued',
        error = null,
        expires_at = now() + interval '15 minutes',
        completed_at = null
    where s.id = v_existing.id
    returning s.* into v_session;
  end if;

  return query
    select
      v_session.id,
      v_session.object_key,
      v_session.storage_bucket,
      v_session.reserved_bytes,
      greatest(
        0,
        v_limit_bytes - v_used_bytes - v_active_reserved - v_reserved_bytes
      ),
      v_session.expires_at,
      false;
end;
$$;

create or replace function public.cancel_photo_upload_session(
  p_session_id uuid
)
returns table (
  storage_provider text,
  storage_bucket text,
  object_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.photo_upload_sessions%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  select s.*
  into v_session
  from public.photo_upload_sessions s
  where s.id = p_session_id
    and s.owner_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'completed' then
    raise exception using errcode = 'P0001', message = 'UPLOAD_ALREADY_COMPLETED';
  end if;

  update public.photo_upload_sessions s
  set status = 'cancelled',
      error = coalesce(s.error, 'Cancelled by uploader')
  where s.id = v_session.id;

  return query
    select
      v_session.storage_provider,
      v_session.storage_bucket,
      v_session.object_key;
end;
$$;

revoke all on function public.reserve_photo_upload(
  uuid, uuid, text, text, text, text, bigint, text, text, uuid, text, boolean, boolean
) from public, anon;
grant execute on function public.reserve_photo_upload(
  uuid, uuid, text, text, text, text, bigint, text, text, uuid, text, boolean, boolean
) to authenticated, service_role;

revoke all on function public.cancel_photo_upload_session(uuid)
  from public, anon;
grant execute on function public.cancel_photo_upload_session(uuid)
  to authenticated, service_role;
