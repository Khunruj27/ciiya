-- Guest moments live beside a public album, but never mix with the
-- photographer's delivered photos. Public reads and guest writes go through
-- the guarded share API; album owners retain direct access through RLS.

create table if not exists public.guest_moments (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  guest_name text not null default 'Guest',
  message text,
  image_urls text[] not null default '{}',
  storage_paths text[] not null default '{}',
  guest_key_hash text,
  status text not null default 'published',
  created_at timestamptz not null default now(),

  constraint guest_moments_name_length
    check (char_length(guest_name) between 1 and 60),
  constraint guest_moments_message_length
    check (message is null or char_length(message) <= 280),
  constraint guest_moments_image_count
    check (cardinality(image_urls) between 1 and 4),
  constraint guest_moments_status_check
    check (status in ('published', 'hidden'))
);

create index if not exists idx_guest_moments_album_created
  on public.guest_moments(album_id, created_at desc)
  where status = 'published';

create index if not exists idx_guest_moments_rate_limit
  on public.guest_moments(album_id, guest_key_hash, created_at desc);

alter table public.guest_moments enable row level security;

drop policy if exists "guest_moments_owner_select" on public.guest_moments;
drop policy if exists "guest_moments_owner_update" on public.guest_moments;
drop policy if exists "guest_moments_owner_delete" on public.guest_moments;

create policy "guest_moments_owner_select"
on public.guest_moments for select
using (
  exists (
    select 1 from public.albums
    where albums.id = guest_moments.album_id
      and auth.uid() = coalesce(albums.owner_id, albums.user_id)
  )
);

create policy "guest_moments_owner_update"
on public.guest_moments for update
using (
  exists (
    select 1 from public.albums
    where albums.id = guest_moments.album_id
      and auth.uid() = coalesce(albums.owner_id, albums.user_id)
  )
);

create policy "guest_moments_owner_delete"
on public.guest_moments for delete
using (
  exists (
    select 1 from public.albums
    where albums.id = guest_moments.album_id
      and auth.uid() = coalesce(albums.owner_id, albums.user_id)
  )
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'guest-moments',
  'guest-moments',
  true,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "guest_moments_storage_public_read" on storage.objects;

create policy "guest_moments_storage_public_read"
on storage.objects for select
using (bucket_id = 'guest-moments');
