-- A photographer's public portfolio: the page they send to a prospective
-- client. One row per user. It stays unpublished until they choose to
-- publish, so an empty half-filled page is never reachable by a stranger.

create table if not exists public.portfolios (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- The public URL is /p/{slug}. Lower-case, unique, theirs to change.
  slug text unique not null,

  display_name text,
  tagline text,
  bio text,
  location text,

  -- Chosen from their own photos; falls back to a featured album's cover.
  hero_photo_url text,

  contact_line text,
  contact_phone text,
  contact_email text,
  contact_instagram text,

  -- Customisation. Kept to a named choice rather than free-form colour so a
  -- portfolio cannot render text that fails contrast against its own ground.
  accent text not null default 'gold',
  layout text not null default 'editorial',

  is_published boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.portfolios
  add constraint portfolios_slug_format
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

alter table public.portfolios
  add constraint portfolios_accent_check
  check (accent in ('gold', 'ink', 'rose'));

alter table public.portfolios
  add constraint portfolios_layout_check
  check (layout in ('editorial', 'grid'));

create index if not exists idx_portfolios_published
  on public.portfolios(slug)
  where is_published = true;

drop trigger if exists trg_portfolios_updated_at on public.portfolios;
create trigger trg_portfolios_updated_at
before update on public.portfolios
for each row execute procedure public.set_updated_at();

alter table public.portfolios enable row level security;

drop policy if exists "portfolios_select_own" on public.portfolios;
drop policy if exists "portfolios_insert_own" on public.portfolios;
drop policy if exists "portfolios_update_own" on public.portfolios;
drop policy if exists "portfolios_delete_own" on public.portfolios;
drop policy if exists "portfolios_public_select" on public.portfolios;

create policy "portfolios_select_own"
on public.portfolios for select
using (auth.uid() = user_id);

create policy "portfolios_insert_own"
on public.portfolios for insert
with check (auth.uid() = user_id);

create policy "portfolios_update_own"
on public.portfolios for update
using (auth.uid() = user_id);

create policy "portfolios_delete_own"
on public.portfolios for delete
using (auth.uid() = user_id);

-- Anyone may read a published portfolio; that is the whole point of it.
create policy "portfolios_public_select"
on public.portfolios for select
using (is_published = true);
