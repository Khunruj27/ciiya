-- Phase 5: provider-aware, retry-safe R2 upload finalization.
-- These RPCs bind finalization to the authenticated reservation created in
-- Phase 4. They do not insert photos; the existing finalizer remains the only
-- application path that creates the photo row and queues processing work.

create or replace function public.begin_photo_upload_finalization(
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
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.photo_upload_sessions%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  select s.* into v_session
  from public.photo_upload_sessions s
  where s.id = p_session_id
    and s.owner_id = v_user_id
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
$$;

create or replace function public.complete_photo_upload_finalization(
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
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.photo_upload_sessions%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  select s.* into v_session
  from public.photo_upload_sessions s
  where s.id = p_session_id
    and s.owner_id = v_user_id
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
$$;

revoke all on function public.begin_photo_upload_finalization(uuid)
  from public, anon;
grant execute on function public.begin_photo_upload_finalization(uuid)
  to authenticated, service_role;

revoke all on function public.complete_photo_upload_finalization(uuid, uuid)
  from public, anon;
grant execute on function public.complete_photo_upload_finalization(uuid, uuid)
  to authenticated, service_role;
