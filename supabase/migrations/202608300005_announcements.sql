-- Platform announcements are stored once and matched to users at read time.
-- Per-user state remains small: one row only after a user reads/clicks it.
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  announcement_type text not null default 'update',
  title text not null,
  summary text not null,
  body text,
  image_url text,
  cta_label text,
  cta_url text,
  audience_type text not null default 'all',
  audience_values text[] not null default '{}'::text[],
  priority text not null default 'normal',
  status text not null default 'draft',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_type_check check (
    announcement_type in ('feature', 'promotion', 'update', 'maintenance', 'tip', 'security')
  ),
  constraint announcements_audience_check check (
    audience_type in ('all', 'plans', 'users')
  ),
  constraint announcements_priority_check check (
    priority in ('normal', 'important', 'critical')
  ),
  constraint announcements_status_check check (
    status in ('draft', 'scheduled', 'published', 'expired', 'cancelled')
  ),
  constraint announcements_title_length check (char_length(title) between 1 and 120),
  constraint announcements_summary_length check (char_length(summary) between 1 and 280)
);

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at
before update on public.announcements
for each row execute procedure public.set_updated_at();

create index if not exists idx_announcements_delivery
on public.announcements(status, starts_at desc, expires_at);

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  clicked_at timestamptz,
  dismissed_at timestamptz,
  primary key (announcement_id, user_id)
);

create index if not exists idx_announcement_reads_user
on public.announcement_reads(user_id, read_at desc);

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

drop policy if exists "announcements_recipient_select" on public.announcements;
create policy "announcements_recipient_select"
on public.announcements for select
to authenticated
using (
  status in ('published', 'scheduled')
  and starts_at <= now()
  and (expires_at is null or expires_at > now())
  and (
    audience_type = 'all'
    or (
      audience_type = 'users'
      and auth.uid()::text = any(audience_values)
    )
    or (
      audience_type = 'plans'
      and (
        exists (
          select 1 from public.user_storage_usage usage
          where usage.user_id = auth.uid()
          and lower(coalesce(usage.current_plan, 'free')) = any(audience_values)
        )
        or (
          'free' = any(audience_values)
          and not exists (
            select 1 from public.user_storage_usage usage
            where usage.user_id = auth.uid()
          )
        )
      )
    )
  )
);

drop policy if exists "announcement_reads_owner_select" on public.announcement_reads;
drop policy if exists "announcement_reads_owner_insert" on public.announcement_reads;
drop policy if exists "announcement_reads_owner_update" on public.announcement_reads;

create policy "announcement_reads_owner_select"
on public.announcement_reads for select to authenticated
using (user_id = auth.uid());

create policy "announcement_reads_owner_insert"
on public.announcement_reads for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.announcements announcement
    where announcement.id = announcement_id
  )
);

create policy "announcement_reads_owner_update"
on public.announcement_reads for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke all on public.announcements from anon;
revoke all on public.announcement_reads from anon;
grant select on public.announcements to authenticated;
grant select, insert, update on public.announcement_reads to authenticated;
grant all on public.announcements to service_role;
grant all on public.announcement_reads to service_role;
