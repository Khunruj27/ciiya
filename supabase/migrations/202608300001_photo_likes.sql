-- Anonymous "heart" reactions for gallery photos on the public share page,
-- mirroring the Guest Moments like model. A one-way visitor key is stored,
-- never a raw IP or user agent.

alter table public.photos
  add column if not exists like_count integer not null default 0;

alter table public.photos
  drop constraint if exists photos_like_count_check;

alter table public.photos
  add constraint photos_like_count_check check (like_count >= 0);

create table if not exists public.photo_likes (
  photo_id uuid not null references public.photos(id) on delete cascade,
  guest_key_hash text not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, guest_key_hash)
);

create index if not exists idx_photo_likes_photo on public.photo_likes(photo_id);

alter table public.photo_likes enable row level security;

create or replace function public.toggle_photo_like(
  p_photo_id uuid,
  p_guest_key_hash text
)
returns table(liked boolean, total integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_total integer;
begin
  if exists (
    select 1 from public.photo_likes
    where photo_id = p_photo_id
      and guest_key_hash = p_guest_key_hash
  ) then
    delete from public.photo_likes
    where photo_id = p_photo_id
      and guest_key_hash = p_guest_key_hash;

    update public.photos
    set like_count = greatest(0, like_count - 1)
    where id = p_photo_id
    returning like_count into next_total;

    return query select false, coalesce(next_total, 0);
  end if;

  insert into public.photo_likes(photo_id, guest_key_hash)
  values (p_photo_id, p_guest_key_hash)
  on conflict do nothing;

  if found then
    update public.photos
    set like_count = like_count + 1
    where id = p_photo_id
    returning like_count into next_total;

    return query select true, coalesce(next_total, 0);
  end if;

  select like_count into next_total from public.photos where id = p_photo_id;
  return query select true, coalesce(next_total, 0);
end;
$$;

revoke all on function public.toggle_photo_like(uuid, text) from public;
revoke all on function public.toggle_photo_like(uuid, text) from anon;
revoke all on function public.toggle_photo_like(uuid, text) from authenticated;
grant execute on function public.toggle_photo_like(uuid, text) to service_role;
