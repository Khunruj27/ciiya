-- Phase 14.5.3: device-authenticated Ciiya Sync uploads.
--
-- Ciiya Sync reuses the existing R2 upload reservation and finalization
-- invariants, but its bearer token is not a Supabase user session. These
-- service-role-only RPCs derive the owner from an active, scoped device and
-- bind every upload session to that exact device.

alter table public.photo_upload_sessions
  add column if not exists ciiya_sync_device_id uuid
    references public.ciiya_sync_devices(id) on delete set null;

create index if not exists idx_photo_upload_sessions_sync_device
  on public.photo_upload_sessions (ciiya_sync_device_id, created_at desc)
  where ciiya_sync_device_id is not null;

create or replace function public.ciiya_sync_device_owner(
  p_device_id uuid,
  p_required_scope text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner_id uuid;
begin
  select d.owner_id into v_owner_id
  from public.ciiya_sync_devices d
  where d.id = p_device_id
    and d.revoked_at is null
    and d.token_expires_at > now()
    and p_required_scope = any(d.scopes);

  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'SYNC_DEVICE_UNAUTHORIZED';
  end if;

  return v_owner_id;
end;
$function$;

revoke all
on function public.ciiya_sync_device_owner(uuid, text)
from public, anon, authenticated;
grant execute
on function public.ciiya_sync_device_owner(uuid, text)
to service_role;

create or replace function public.reserve_ciiya_sync_photo_upload(
  p_device_id uuid,
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
as $function$
declare
  v_user_id uuid := public.ciiya_sync_device_owner(
    p_device_id,
    'photos:upload'
  );
  v_existing public.photo_upload_sessions%rowtype;
  v_session public.photo_upload_sessions%rowtype;
  v_used_bytes bigint := 0;
  v_limit_bytes bigint := 5368709120;
  v_active_reserved bigint := 0;
  v_reserved_bytes bigint;
  v_expected_prefix text;
  v_object_name text;
begin
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

  update public.photo_upload_sessions s
  set status = 'expired',
      error = coalesce(s.error, 'Signed upload session expired')
  where s.owner_id = v_user_id
    and s.status in ('issued', 'uploading', 'finalizing')
    and s.expires_at <= now();

  select s.* into v_existing
  from public.photo_upload_sessions s
  where s.owner_id = v_user_id
    and s.client_upload_id = p_client_upload_id
  for update;

  if found and v_existing.ciiya_sync_device_id is distinct from p_device_id then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_CONFLICT';
  end if;

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
      photo_id,
      ciiya_sync_device_id,
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
    ) values (
      p_client_upload_id,
      v_user_id,
      p_album_id,
      p_category_id,
      null,
      p_device_id,
      'r2',
      p_storage_bucket,
      p_object_key,
      p_original_file_name,
      p_content_type,
      p_expected_size_bytes,
      v_reserved_bytes,
      p_file_hash,
      p_requested_size,
      null,
      p_auto_face_scan,
      p_auto_publish,
      'issued',
      null,
      now() + interval '15 minutes'
    ) returning * into v_session;
  else
    update public.photo_upload_sessions s
    set album_id = p_album_id,
        category_id = p_category_id,
        photo_id = null,
        ciiya_sync_device_id = p_device_id,
        storage_provider = 'r2',
        storage_bucket = p_storage_bucket,
        object_key = p_object_key,
        original_file_name = p_original_file_name,
        content_type = p_content_type,
        expected_size_bytes = p_expected_size_bytes,
        reserved_bytes = v_reserved_bytes,
        file_hash = p_file_hash,
        requested_size = p_requested_size,
        preset_path = null,
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
$function$;

revoke all
on function public.reserve_ciiya_sync_photo_upload(
  uuid, uuid, uuid, text, text, text, text, bigint, text, text, uuid, boolean, boolean
)
from public, anon, authenticated;
grant execute
on function public.reserve_ciiya_sync_photo_upload(
  uuid, uuid, uuid, text, text, text, text, bigint, text, text, uuid, boolean, boolean
)
to service_role;

create or replace function public.cancel_ciiya_sync_photo_upload(
  p_device_id uuid,
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
as $function$
declare
  v_user_id uuid := public.ciiya_sync_device_owner(
    p_device_id,
    'photos:upload'
  );
  v_session public.photo_upload_sessions%rowtype;
begin
  select s.* into v_session
  from public.photo_upload_sessions s
  where s.id = p_session_id
    and s.owner_id = v_user_id
    and s.ciiya_sync_device_id = p_device_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'completed' then
    raise exception using errcode = 'P0001', message = 'UPLOAD_ALREADY_COMPLETED';
  end if;

  update public.photo_upload_sessions s
  set status = 'cancelled',
      error = coalesce(s.error, 'Cancelled by Ciiya Sync')
  where s.id = v_session.id;

  return query select
    v_session.storage_provider,
    v_session.storage_bucket,
    v_session.object_key;
end;
$function$;

revoke all
on function public.cancel_ciiya_sync_photo_upload(uuid, uuid)
from public, anon, authenticated;
grant execute
on function public.cancel_ciiya_sync_photo_upload(uuid, uuid)
to service_role;

create or replace function public.begin_ciiya_sync_photo_upload_finalization(
  p_device_id uuid,
  p_session_id uuid
)
returns table (
  session_id uuid,
  session_owner_id uuid,
  session_album_id uuid,
  session_category_id uuid,
  completed_photo_id uuid,
  session_storage_provider text,
  session_storage_bucket text,
  session_object_key text,
  session_original_file_name text,
  session_content_type text,
  session_expected_size_bytes bigint,
  session_file_hash text,
  session_requested_size text,
  session_preset_path text,
  session_auto_face_scan boolean,
  session_auto_publish boolean,
  session_status text,
  session_expires_at timestamptz,
  already_completed boolean
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := public.ciiya_sync_device_owner(
    p_device_id,
    'photos:upload'
  );
  v_session public.photo_upload_sessions%rowtype;
begin
  select s.* into v_session
  from public.photo_upload_sessions s
  where s.id = p_session_id
    and s.owner_id = v_user_id
    and s.ciiya_sync_device_id = p_device_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'completed' then
    return query select
      v_session.id,
      v_session.owner_id,
      v_session.album_id,
      v_session.category_id,
      v_session.photo_id,
      v_session.storage_provider,
      v_session.storage_bucket,
      v_session.object_key,
      v_session.original_file_name,
      v_session.content_type,
      v_session.expected_size_bytes,
      v_session.file_hash,
      v_session.requested_size,
      v_session.preset_path,
      v_session.auto_face_scan,
      v_session.auto_publish,
      v_session.status,
      v_session.expires_at,
      true;
    return;
  end if;

  if v_session.status not in ('issued', 'uploading', 'finalizing') then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FINALIZABLE';
  end if;

  if v_session.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_EXPIRED';
  end if;

  update public.photo_upload_sessions s
  set status = 'finalizing',
      error = null,
      expires_at = greatest(s.expires_at, now() + interval '5 minutes')
  where s.id = v_session.id
  returning s.* into v_session;

  return query select
    v_session.id,
    v_session.owner_id,
    v_session.album_id,
    v_session.category_id,
    v_session.photo_id,
    v_session.storage_provider,
    v_session.storage_bucket,
    v_session.object_key,
    v_session.original_file_name,
    v_session.content_type,
    v_session.expected_size_bytes,
    v_session.file_hash,
    v_session.requested_size,
    v_session.preset_path,
    v_session.auto_face_scan,
    v_session.auto_publish,
    v_session.status,
    v_session.expires_at,
    false;
end;
$function$;

revoke all
on function public.begin_ciiya_sync_photo_upload_finalization(uuid, uuid)
from public, anon, authenticated;
grant execute
on function public.begin_ciiya_sync_photo_upload_finalization(uuid, uuid)
to service_role;

create or replace function public.complete_ciiya_sync_photo_upload_finalization(
  p_device_id uuid,
  p_session_id uuid,
  p_photo_id uuid
)
returns table (
  session_id uuid,
  completed_photo_id uuid,
  completed_at timestamptz,
  already_completed boolean
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := public.ciiya_sync_device_owner(
    p_device_id,
    'photos:upload'
  );
  v_session public.photo_upload_sessions%rowtype;
begin
  select s.* into v_session
  from public.photo_upload_sessions s
  where s.id = p_session_id
    and s.owner_id = v_user_id
    and s.ciiya_sync_device_id = p_device_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'completed' then
    if v_session.photo_id is distinct from p_photo_id then
      raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_PHOTO_CONFLICT';
    end if;

    return query select
      v_session.id,
      v_session.photo_id,
      v_session.completed_at,
      true;
    return;
  end if;

  if v_session.status <> 'finalizing' then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FINALIZING';
  end if;

  if not exists (
    select 1
    from public.photos p
    where p.id = p_photo_id
      and p.owner_id = v_user_id
      and p.album_id = v_session.album_id
      and p.storage_provider = 'r2'
      and p.storage_bucket = v_session.storage_bucket
      and p.storage_path = v_session.object_key
      and p.original_path = v_session.object_key
      and p.file_hash = v_session.file_hash
      and p.original_size_bytes = v_session.expected_size_bytes
  ) then
    raise exception using errcode = 'P0001', message = 'PHOTO_UPLOAD_BINDING_MISMATCH';
  end if;

  update public.photo_upload_sessions s
  set status = 'completed',
      photo_id = p_photo_id,
      completed_at = now(),
      error = null
  where s.id = v_session.id
  returning s.* into v_session;

  return query select
    v_session.id,
    v_session.photo_id,
    v_session.completed_at,
    false;
end;
$function$;

revoke all
on function public.complete_ciiya_sync_photo_upload_finalization(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute
on function public.complete_ciiya_sync_photo_upload_finalization(uuid, uuid, uuid)
to service_role;
