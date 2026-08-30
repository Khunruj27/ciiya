-- Activity stream shared by owner notifications and per-album analytics.
-- Public visitors never read this table; public share APIs write through the
-- service role after validating the album/share token.
create table if not exists public.share_events (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  photo_id uuid references public.photos(id) on delete set null,
  event_type text not null,
  guest_key_hash text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint share_events_type_check check (
    event_type in (
      'album_view',
      'photo_download',
      'photo_like',
      'moment_created',
      'moment_like',
      'face_search'
    )
  )
);

create index if not exists idx_share_events_owner_created
on public.share_events(owner_id, created_at desc);

create index if not exists idx_share_events_album_created
on public.share_events(album_id, created_at desc);

create index if not exists idx_share_events_owner_unread
on public.share_events(owner_id, created_at desc)
where read_at is null;

alter table public.share_events enable row level security;

drop policy if exists "share_events_owner_select" on public.share_events;
drop policy if exists "share_events_owner_update" on public.share_events;

create policy "share_events_owner_select"
on public.share_events for select
to authenticated
using (owner_id = auth.uid());

create policy "share_events_owner_update"
on public.share_events for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

revoke all on public.share_events from anon;
grant select, update on public.share_events to authenticated;
grant all on public.share_events to service_role;

