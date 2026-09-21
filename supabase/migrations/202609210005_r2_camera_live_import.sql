-- Phase 9: provider-aware camera live imports.
-- Existing rows remain Supabase-backed. New R2 camera imports receive a
-- quota reservation that is bound to the camera import row and may only be
-- created/finalized by the service-role camera worker.

alter table public.camera_live_imports
  add column if not exists storage_provider text;
alter table public.camera_live_imports
  add column if not exists storage_bucket text;
alter table public.camera_live_imports
  add column if not exists photo_upload_session_id uuid;

update public.camera_live_imports
set storage_provider = 'supabase'
where storage_provider is null;

update public.camera_live_imports
set storage_bucket = 'albums'
where storage_bucket is null;

alter table public.camera_live_imports
  alter column storage_provider set default 'supabase';
alter table public.camera_live_imports
  alter column storage_provider set not null;
alter table public.camera_live_imports
  alter column storage_bucket set default 'albums';
alter table public.camera_live_imports
  alter column storage_bucket set not null;

alter table public.camera_live_imports
  drop constraint if exists camera_live_imports_storage_provider_check;
alter table public.camera_live_imports
  add constraint camera_live_imports_storage_provider_check
  check (storage_provider in ('supabase', 'r2')) not valid;
alter table public.camera_live_imports
  validate constraint camera_live_imports_storage_provider_check;

alter table public.camera_live_imports
  drop constraint if exists camera_live_imports_photo_upload_session_fkey;
alter table public.camera_live_imports
  add constraint camera_live_imports_photo_upload_session_fkey
  foreign key (photo_upload_session_id)
  references public.photo_upload_sessions(id)
  on delete set null
  not valid;
alter table public.camera_live_imports
  validate constraint camera_live_imports_photo_upload_session_fkey;

create index if not exists idx_camera_live_imports_upload_session
  on public.camera_live_imports(photo_upload_session_id)
  where photo_upload_session_id is not null;

create or replace function public.reserve_camera_photo_upload(
  p_camera_import_id uuid,
  p_storage_bucket text,
  p_object_key text,
  p_original_file_name text,
  p_content_type text,
  p_expected_size_bytes bigint,
  p_file_hash text,
  p_requested_size text,
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
  v_import public.camera_live_imports%rowtype;
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
  select i.* into v_import
  from public.camera_live_imports i
  where i.id = p_camera_import_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'CAMERA_IMPORT_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.camera_upload_sessions cs
    join public.albums a on a.id = cs.album_id
    where cs.id = v_import.session_id
      and cs.album_id = v_import.album_id
      and cs.owner_id = v_import.owner_id
      and cs.status = 'active'
      and (a.owner_id = v_import.owner_id or a.user_id = v_import.owner_id)
  ) then
    raise exception using errcode = 'P0001', message = 'CAMERA_SESSION_NOT_ACTIVE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_import.owner_id::text, 0));

  if p_expected_size_bytes < 1 or p_expected_size_bytes > 209715200 then
    raise exception using errcode = 'P0001', message = 'INVALID_UPLOAD_SIZE';
  end if;
  if p_content_type <> 'image/jpeg' then
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

  v_expected_prefix :=
    v_import.owner_id::text || '/' || v_import.album_id::text || '/original/';
  v_expected_album_preset_prefix :=
    v_import.owner_id::text || '/' || v_import.album_id::text || '/presets/';
  v_expected_user_preset_prefix := v_import.owner_id::text || '/presets/';
  v_object_name := substring(p_object_key from length(v_expected_prefix) + 1);

  if p_object_key not like v_expected_prefix || '%'
    or p_object_key like '%..%'
    or position(chr(92) in p_object_key) > 0
    or p_object_key like '%//%'
    or length(p_object_key) > 1024
    or v_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
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
  where s.owner_id = v_import.owner_id
    and s.status in ('issued', 'uploading', 'finalizing')
    and s.expires_at <= now();

  select s.* into v_existing
  from public.photo_upload_sessions s
  where s.owner_id = v_import.owner_id
    and s.client_upload_id = v_import.id
  for update;

  if found and v_existing.status in ('issued', 'uploading', 'finalizing', 'completed') then
    if v_existing.album_id <> v_import.album_id
      or v_existing.storage_bucket <> p_storage_bucket
      or v_existing.object_key <> p_object_key
      or v_existing.original_file_name <> p_original_file_name
      or v_existing.content_type <> p_content_type
      or v_existing.expected_size_bytes <> p_expected_size_bytes
      or v_existing.file_hash <> p_file_hash
    then
      raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_CONFLICT';
    end if;

    update public.camera_live_imports i
    set storage_provider = 'r2',
        storage_bucket = v_existing.storage_bucket,
        storage_path = v_existing.object_key,
        photo_upload_session_id = v_existing.id,
        updated_at = now()
    where i.id = v_import.id;

    return query select
      v_existing.id,
      v_existing.object_key,
      v_existing.storage_bucket,
      v_existing.reserved_bytes,
      greatest(0, coalesce((
        select u.storage_limit_bytes - coalesce(u.storage_used_bytes, u.used_bytes, 0)
        from public.user_storage_usage u
        where u.user_id = v_import.owner_id
      ), 5368709120)),
      v_existing.expires_at,
      true;
    return;
  end if;

  select coalesce(u.storage_used_bytes, u.used_bytes, 0), u.storage_limit_bytes
  into v_used_bytes, v_limit_bytes
  from public.user_storage_usage u
  where u.user_id = v_import.owner_id;

  if not found then
    v_used_bytes := 0;
    v_limit_bytes := 5368709120;
  end if;

  select coalesce(sum(s.reserved_bytes), 0)
  into v_active_reserved
  from public.photo_upload_sessions s
  where s.owner_id = v_import.owner_id
    and s.status in ('issued', 'uploading', 'finalizing')
    and s.expires_at > now()
    and s.id is distinct from v_existing.id;

  v_reserved_bytes :=
    p_expected_size_bytes +
    round(p_expected_size_bytes::numeric * 0.35)::bigint +
    round(p_expected_size_bytes::numeric * 0.05)::bigint;

  if v_used_bytes + v_active_reserved + v_reserved_bytes > v_limit_bytes then
    raise exception using errcode = 'P0001', message = 'STORAGE_LIMIT_EXCEEDED';
  end if;

  if v_existing.id is null then
    insert into public.photo_upload_sessions (
      client_upload_id, owner_id, album_id, storage_provider, storage_bucket,
      object_key, original_file_name, content_type, expected_size_bytes,
      reserved_bytes, file_hash, requested_size, preset_path, auto_face_scan,
      auto_publish, status, error, expires_at
    ) values (
      v_import.id, v_import.owner_id, v_import.album_id, 'r2', p_storage_bucket,
      p_object_key, p_original_file_name, p_content_type, p_expected_size_bytes,
      v_reserved_bytes, p_file_hash, p_requested_size, p_preset_path,
      p_auto_face_scan, p_auto_publish, 'issued', null,
      now() + interval '15 minutes'
    ) returning * into v_session;
  else
    update public.photo_upload_sessions s
    set album_id = v_import.album_id,
        category_id = null,
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

  update public.camera_live_imports i
  set storage_provider = 'r2',
      storage_bucket = v_session.storage_bucket,
      storage_path = v_session.object_key,
      photo_upload_session_id = v_session.id,
      updated_at = now()
  where i.id = v_import.id;

  return query select
    v_session.id,
    v_session.object_key,
    v_session.storage_bucket,
    v_session.reserved_bytes,
    greatest(0, v_limit_bytes - v_used_bytes - v_active_reserved - v_reserved_bytes),
    v_session.expires_at,
    false;
end;
$$;

create or replace function public.begin_camera_photo_upload_finalization(
  p_session_id uuid,
  p_camera_import_id uuid
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
as $$
declare
  v_import public.camera_live_imports%rowtype;
  v_session public.photo_upload_sessions%rowtype;
begin
  select i.* into v_import
  from public.camera_live_imports i
  where i.id = p_camera_import_id
    and i.photo_upload_session_id = p_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'CAMERA_UPLOAD_BINDING_MISMATCH';
  end if;

  select s.* into v_session
  from public.photo_upload_sessions s
  where s.id = p_session_id
    and s.owner_id = v_import.owner_id
    and s.album_id = v_import.album_id
    and s.storage_provider = 'r2'
    and s.storage_bucket = v_import.storage_bucket
    and s.object_key = v_import.storage_path
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'completed' then
    return query select
      v_session.id, v_session.owner_id, v_session.album_id,
      v_session.category_id, v_session.photo_id, v_session.storage_provider,
      v_session.storage_bucket, v_session.object_key,
      v_session.original_file_name, v_session.content_type,
      v_session.expected_size_bytes, v_session.file_hash,
      v_session.requested_size, v_session.preset_path,
      v_session.auto_face_scan, v_session.auto_publish, v_session.status,
      v_session.expires_at, true;
    return;
  end if;

  if v_session.status not in ('issued', 'uploading', 'finalizing') then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FINALIZABLE';
  end if;
  if v_session.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_EXPIRED';
  end if;

  update public.photo_upload_sessions s
  set status = 'finalizing', error = null,
      expires_at = greatest(s.expires_at, now() + interval '5 minutes')
  where s.id = v_session.id
  returning s.* into v_session;

  return query select
    v_session.id, v_session.owner_id, v_session.album_id,
    v_session.category_id, v_session.photo_id, v_session.storage_provider,
    v_session.storage_bucket, v_session.object_key,
    v_session.original_file_name, v_session.content_type,
    v_session.expected_size_bytes, v_session.file_hash,
    v_session.requested_size, v_session.preset_path,
    v_session.auto_face_scan, v_session.auto_publish, v_session.status,
    v_session.expires_at, false;
end;
$$;

create or replace function public.complete_camera_photo_upload_finalization(
  p_session_id uuid,
  p_camera_import_id uuid,
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
as $$
declare
  v_import public.camera_live_imports%rowtype;
  v_session public.photo_upload_sessions%rowtype;
begin
  select i.* into v_import
  from public.camera_live_imports i
  where i.id = p_camera_import_id
    and i.photo_upload_session_id = p_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'CAMERA_UPLOAD_BINDING_MISMATCH';
  end if;

  select s.* into v_session
  from public.photo_upload_sessions s
  where s.id = p_session_id
    and s.owner_id = v_import.owner_id
    and s.album_id = v_import.album_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'completed' then
    if v_session.photo_id is distinct from p_photo_id then
      raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_PHOTO_CONFLICT';
    end if;
    return query select v_session.id, v_session.photo_id,
      v_session.completed_at, true;
    return;
  end if;

  if v_session.status <> 'finalizing' then
    raise exception using errcode = 'P0001', message = 'UPLOAD_SESSION_NOT_FINALIZING';
  end if;

  if not exists (
    select 1 from public.photos p
    where p.id = p_photo_id
      and p.owner_id = v_import.owner_id
      and p.album_id = v_import.album_id
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
  set status = 'completed', photo_id = p_photo_id, completed_at = now(), error = null
  where s.id = v_session.id
  returning s.* into v_session;

  return query select v_session.id, v_session.photo_id,
    v_session.completed_at, false;
end;
$$;

create or replace function public.cancel_camera_photo_upload(
  p_session_id uuid,
  p_camera_import_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.camera_live_imports i
    where i.id = p_camera_import_id
      and i.photo_upload_session_id = p_session_id
  ) then
    raise exception using errcode = 'P0001', message = 'CAMERA_UPLOAD_BINDING_MISMATCH';
  end if;

  update public.photo_upload_sessions s
  set status = 'cancelled', error = coalesce(s.error, 'Camera upload cancelled')
  where s.id = p_session_id
    and s.status in ('issued', 'uploading', 'finalizing');
end;
$$;

revoke all on function public.reserve_camera_photo_upload(
  uuid, text, text, text, text, bigint, text, text, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.reserve_camera_photo_upload(
  uuid, text, text, text, text, bigint, text, text, text, boolean, boolean
) to service_role;

revoke all on function public.begin_camera_photo_upload_finalization(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_camera_photo_upload_finalization(uuid, uuid)
  to service_role;

revoke all on function public.complete_camera_photo_upload_finalization(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_camera_photo_upload_finalization(uuid, uuid, uuid)
  to service_role;

revoke all on function public.cancel_camera_photo_upload(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_camera_photo_upload(uuid, uuid)
  to service_role;
