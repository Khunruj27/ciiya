-- albums.photo_count has been set to 0 at creation and never
-- incremented/decremented since — it was dead data. Add triggers
-- mirroring the existing user_storage_usage pattern, then backfill.

create or replace function public.update_album_photo_count_after_insert()
returns trigger
language plpgsql
as $$
begin
  update public.albums
  set photo_count = coalesce(photo_count, 0) + 1,
      updated_at = now()
  where id = new.album_id;

  return new;
end;
$$;

drop trigger if exists trg_photo_insert_album_count on public.photos;
create trigger trg_photo_insert_album_count
after insert on public.photos
for each row execute procedure public.update_album_photo_count_after_insert();

create or replace function public.update_album_photo_count_after_delete()
returns trigger
language plpgsql
as $$
begin
  update public.albums
  set photo_count = greatest(0, coalesce(photo_count, 0) - 1),
      updated_at = now()
  where id = old.album_id;

  return old;
end;
$$;

drop trigger if exists trg_photo_delete_album_count on public.photos;
create trigger trg_photo_delete_album_count
after delete on public.photos
for each row execute procedure public.update_album_photo_count_after_delete();

update public.albums a
set photo_count = coalesce((
  select count(*) from public.photos p where p.album_id = a.id
), 0);
