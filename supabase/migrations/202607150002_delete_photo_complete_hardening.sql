-- Atomic and idempotent photo deletion for Ciiya V54.1.
-- Ownership is validated once, then all related database cleanup
-- runs inside the same PostgreSQL transaction.

create or replace function public.delete_photo_complete(
  target_photo_id uuid,
  target_owner_id uuid
)
returns table(
  deleted_photo_id uuid,
  album_id uuid
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  locked_photo_id uuid;
  locked_album_id uuid;
  deleted_count integer := 0;
begin
  if target_photo_id is null then
    raise exception 'target_photo_id is required';
  end if;

  if target_owner_id is null then
    raise exception 'target_owner_id is required';
  end if;

  /*
   * Lock the photo row so concurrent deletion requests
   * cannot process the same photo simultaneously.
   */
  select
    p.id,
    p.album_id
  into
    locked_photo_id,
    locked_album_id
  from public.photos p
  where p.id = target_photo_id
    and p.owner_id = target_owner_id
  for update;

  /*
   * Idempotent behavior:
   * if another request already deleted the photo,
   * return no rows instead of raising an internal error.
   */
  if locked_photo_id is null then
    return;
  end if;

  /*
   * Clear album covers inside the same transaction.
   * This removes the race caused by clearing covers in the API
   * before calling the delete RPC.
   */
  update public.albums
  set
    cover_photo_id = null,
    cover_url = null,
    updated_at = now()
  where cover_photo_id = target_photo_id
    and owner_id = target_owner_id;

  /*
   * Prevent a face cluster from keeping a deleted photo
   * as its preview image.
   */
  update public.face_clusters
  set preview_photo_id = null
  where preview_photo_id = target_photo_id
    and owner_id = target_owner_id;

  /*
   * Ownership has already been validated on the locked photo.
   * Delete related records by photo_id so legacy rows with a
   * missing owner_id cannot remain as orphans.
   */
  delete from public.worker_logs
  where photo_id = target_photo_id;

  delete from public.photo_jobs
  where photo_id = target_photo_id;

  delete from public.face_jobs
  where photo_id = target_photo_id;

  delete from public.photo_faces
  where photo_id = target_photo_id;

  delete from public.photos
  where id = target_photo_id
    and owner_id = target_owner_id;

  get diagnostics deleted_count = row_count;

  if deleted_count <> 1 then
    raise exception
      'Photo deletion did not affect exactly one row';
  end if;

  deleted_photo_id := locked_photo_id;
  album_id := locked_album_id;

  return next;
end;
$function$;

revoke all
on function public.delete_photo_complete(uuid, uuid)
from public;

revoke all
on function public.delete_photo_complete(uuid, uuid)
from anon;

revoke all
on function public.delete_photo_complete(uuid, uuid)
from authenticated;

grant execute
on function public.delete_photo_complete(uuid, uuid)
to service_role;