create or replace function public.increment_photo_download_count(
  target_photo_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count bigint;
begin
  if target_photo_id is null then
    raise exception 'target_photo_id is required';
  end if;

  update public.photos
  set download_count =
    coalesce(download_count, 0) + 1
  where id = target_photo_id
  returning download_count
  into next_count;

  return next_count;
end;
$$;

revoke all
on function public.increment_photo_download_count(uuid)
from public;

grant execute
on function public.increment_photo_download_count(uuid)
to service_role;