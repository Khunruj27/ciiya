-- Public album access must require an explicitly public,
-- active album. A generated share token alone is not enough.

drop policy if exists
  "albums_public_share_select"
on public.albums;

create policy
  "albums_public_share_select"
on public.albums
for select
using (
  is_public = true
  and share_token is not null
  and coalesce(status, 'active') = 'active'
);

drop policy if exists
  "photos_public_share_select"
on public.photos;

create policy
  "photos_public_share_select"
on public.photos
for select
using (
  processing_status = 'done'
  and public_url is not null
  and preview_url is not null
  and thumbnail_url is not null
  and exists (
    select 1
    from public.albums
    where albums.id = photos.album_id
      and albums.is_public = true
      and albums.share_token is not null
      and coalesce(
        albums.status,
        'active'
      ) = 'active'
  )
);

drop policy if exists
  "photo_faces_public_share_select"
on public.photo_faces;

create policy
  "photo_faces_public_share_select"
on public.photo_faces
for select
using (
  exists (
    select 1
    from public.photos
    join public.albums
      on albums.id = photos.album_id
    where photos.id =
      photo_faces.photo_id
      and photos.processing_status =
        'done'
      and albums.is_public = true
      and albums.share_token is not null
      and coalesce(
        albums.status,
        'active'
      ) = 'active'
  )
);