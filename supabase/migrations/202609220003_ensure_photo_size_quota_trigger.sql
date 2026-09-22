-- Keep user_storage_usage synchronized when a photo's authoritative charged
-- size is corrected after upload or during storage migration validation.

create or replace function public.update_storage_after_photo_size_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid;
  diff bigint;
begin
  uid := coalesce(new.owner_id, new.user_id);
  diff := coalesce(new.file_size_bytes, 0) - coalesce(old.file_size_bytes, 0);

  if uid is null or diff = 0 then
    return new;
  end if;

  insert into public.user_storage_usage (
    user_id,
    used_bytes,
    storage_used_bytes,
    photo_count,
    photos_count,
    updated_at
  )
  values (
    uid,
    greatest(0, diff),
    greatest(0, diff),
    0,
    0,
    now()
  )
  on conflict (user_id)
  do update set
    used_bytes = greatest(0, public.user_storage_usage.used_bytes + diff),
    storage_used_bytes = greatest(
      0,
      public.user_storage_usage.storage_used_bytes + diff
    ),
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.update_storage_after_photo_size_update() from public;
revoke all on function public.update_storage_after_photo_size_update() from anon;
revoke all on function public.update_storage_after_photo_size_update() from authenticated;
grant execute on function public.update_storage_after_photo_size_update() to service_role;

drop trigger if exists trg_photo_size_update_storage on public.photos;
create trigger trg_photo_size_update_storage
after update of file_size_bytes on public.photos
for each row execute procedure public.update_storage_after_photo_size_update();
