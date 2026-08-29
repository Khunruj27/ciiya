-- Persistent, anonymous reactions for Guest Moments. The public API derives a
-- one-way visitor key; no raw IP address or user agent is stored.

alter table public.guest_moments
  add column if not exists like_count integer not null default 0;

alter table public.guest_moments
  drop constraint if exists guest_moments_like_count_check;

alter table public.guest_moments
  add constraint guest_moments_like_count_check check (like_count >= 0);

create table if not exists public.guest_moment_likes (
  moment_id uuid not null references public.guest_moments(id) on delete cascade,
  guest_key_hash text not null,
  created_at timestamptz not null default now(),
  primary key (moment_id, guest_key_hash)
);

create index if not exists idx_guest_moment_likes_created
  on public.guest_moment_likes(moment_id, created_at desc);

alter table public.guest_moment_likes enable row level security;

create or replace function public.toggle_guest_moment_like(
  p_moment_id uuid,
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
    select 1 from public.guest_moment_likes
    where moment_id = p_moment_id
      and guest_key_hash = p_guest_key_hash
  ) then
    delete from public.guest_moment_likes
    where moment_id = p_moment_id
      and guest_key_hash = p_guest_key_hash;

    update public.guest_moments
    set like_count = greatest(0, like_count - 1)
    where id = p_moment_id
    returning like_count into next_total;

    return query select false, coalesce(next_total, 0);
  end if;

  insert into public.guest_moment_likes(moment_id, guest_key_hash)
  values (p_moment_id, p_guest_key_hash)
  on conflict do nothing;

  if found then
    update public.guest_moments
    set like_count = like_count + 1
    where id = p_moment_id
    returning like_count into next_total;

    return query select true, coalesce(next_total, 0);
  end if;

  select like_count into next_total
  from public.guest_moments
  where id = p_moment_id;

  return query select true, coalesce(next_total, 0);
end;
$$;

revoke all on function public.toggle_guest_moment_like(uuid, text) from public;
revoke all on function public.toggle_guest_moment_like(uuid, text) from anon;
revoke all on function public.toggle_guest_moment_like(uuid, text) from authenticated;
grant execute on function public.toggle_guest_moment_like(uuid, text) to service_role;
