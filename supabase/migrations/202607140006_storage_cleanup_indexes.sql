-- Storage and photo lookup indexes.
-- Compatible with the actual Ciiya V54.1 schema.

create index if not exists idx_photos_processing_status_created
on public.photos (
  processing_status,
  created_at
);

create index if not exists idx_photos_owner_album
on public.photos (
  owner_id,
  album_id
)
where owner_id is not null;

create index if not exists idx_photos_user_album
on public.photos (
  user_id,
  album_id
)
where user_id is not null;

create index if not exists idx_photos_created_at
on public.photos (
  created_at
);

create index if not exists idx_albums_owner_created
on public.albums (
  owner_id,
  created_at
);

create index if not exists idx_photos_storage_path
on public.photos (
  storage_path
)
where storage_path is not null;

create index if not exists idx_photos_original_path
on public.photos (
  original_path
)
where original_path is not null;