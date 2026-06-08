-- =========================================================
-- CIIYA FULL SUPABASE SCHEMA v2.1
-- Production aligned with latest app / workers
-- Main reference: latest Ciiyaphoto.zip
-- =========================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =========================================================
-- UPDATED_AT
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- PLANS
-- =========================================================

create table if not exists public.plans (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  storage_limit_bytes bigint not null default 0,
  max_albums integer default 9999,
  max_photos integer default 999999,
  stripe_price_id text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at
before update on public.plans
for each row execute procedure public.set_updated_at();

-- =========================================================
-- SUBSCRIPTIONS
-- =========================================================

create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text default 'inactive',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_subscriptions_user
on public.subscriptions(user_id);

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute procedure public.set_updated_at();

-- =========================================================
-- USER STORAGE USAGE
-- =========================================================

create table if not exists public.user_storage_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_plan text default 'free',
  used_bytes bigint not null default 0,
  storage_used_bytes bigint not null default 0,
  storage_limit_bytes bigint not null default 5368709120,
  photo_count integer default 0,
  photos_count integer default 0,
  albums_count integer default 0,
  updated_at timestamptz default now()
);

-- =========================================================
-- ALBUMS
-- =========================================================

create table if not exists public.albums (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  title text not null,
  description text,
  slug text unique,
  share_token text unique not null default encode(gen_random_bytes(12), 'hex'),
  cover_url text,
  cover_photo_id uuid,
  is_public boolean default false,
  allow_download boolean default true,
  allow_original_download boolean default true,
  download_size text not null default 'hd',

  constraint albums_download_size_check
  check (download_size in ('sd', 'hd', 'uhd', 'original')),
  status text default 'active',
  photo_count integer default 0,
  total_size_bytes bigint default 0,
  view_count bigint default 0,
  share_count bigint default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.albums
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists cover_url text,
  add column if not exists cover_photo_id uuid;

create index if not exists idx_albums_user on public.albums(user_id);
create index if not exists idx_albums_owner on public.albums(owner_id);
create index if not exists idx_albums_share_token on public.albums(share_token);

drop trigger if exists trg_albums_updated_at on public.albums;
create trigger trg_albums_updated_at
before update on public.albums
for each row execute procedure public.set_updated_at();

-- =========================================================
-- CATEGORIES
-- =========================================================

create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  album_id uuid not null references public.albums(id) on delete cascade,
  name text not null,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create index if not exists idx_categories_album on public.categories(album_id);

-- =========================================================
-- PHOTOS
-- =========================================================

create table if not exists public.photos (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  album_id uuid not null references public.albums(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,

  filename text,
  file_name text,
  file_hash text,

  storage_path text,
  original_path text,

  public_url text,
  image_url text,
  original_url text,

  preview_path text,
  thumbnail_path text,
  preview_url text,
  thumbnail_url text,
  blur_data_url text,

  sd_path text,
  hd_path text,
  uhd_path text,
  sd_url text,
  hd_url text,
  uhd_url text,

  preset_path text,
  selected_size text default 'hd',

  width integer,
  height integer,
  original_width integer,
  original_height integer,
  preview_width integer,
  preview_height integer,
  thumbnail_width integer,
  thumbnail_height integer,

  mime_type text,

  file_size_bytes bigint default 0,
  original_size_bytes bigint default 0,
  preview_size_bytes bigint default 0,
  thumbnail_size_bytes bigint default 0,

  sort_order integer default 0,

  processing_status text default 'pending',
  processing_progress integer default 0,

  face_scan_status text default 'pending',
  face_scan_progress integer default 0,
  face_scan_error text,
  faces_count integer default 0,

  is_favorite boolean default false,
  is_hidden boolean default false,

  view_count bigint default 0,
  download_count bigint default 0,

  metadata jsonb default '{}'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.photos
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists filename text,
  add column if not exists file_name text,
  add column if not exists file_hash text,
  add column if not exists storage_path text,
  add column if not exists original_path text,
  add column if not exists public_url text,
  add column if not exists image_url text,
  add column if not exists original_url text,
  add column if not exists preview_path text,
  add column if not exists thumbnail_path text,
  add column if not exists preview_url text,
  add column if not exists thumbnail_url text,
  add column if not exists blur_data_url text,
  add column if not exists sd_path text,
  add column if not exists hd_path text,
  add column if not exists uhd_path text,
  add column if not exists sd_url text,
  add column if not exists hd_url text,
  add column if not exists uhd_url text,
  add column if not exists preset_path text,
  add column if not exists selected_size text default 'hd',
  add column if not exists original_width integer,
  add column if not exists original_height integer,
  add column if not exists preview_width integer,
  add column if not exists preview_height integer,
  add column if not exists thumbnail_width integer,
  add column if not exists thumbnail_height integer,
  add column if not exists original_size_bytes bigint default 0,
  add column if not exists preview_size_bytes bigint default 0,
  add column if not exists thumbnail_size_bytes bigint default 0,
  add column if not exists processing_progress integer default 0,
  add column if not exists face_scan_status text default 'pending',
  add column if not exists face_scan_progress integer default 0,
  add column if not exists face_scan_error text,
  add column if not exists faces_count integer default 0;

create index if not exists idx_photos_album on public.photos(album_id);
create index if not exists idx_photos_user on public.photos(user_id);
create index if not exists idx_photos_owner on public.photos(owner_id);
create index if not exists idx_photos_hash on public.photos(file_hash);
create index if not exists idx_photos_album_created on public.photos(album_id, created_at desc);
create index if not exists idx_photos_album_done on public.photos(album_id, processing_status, created_at desc);

create index if not exists idx_photos_public_gallery
on public.photos(album_id, processing_status, created_at desc)
where public_url is not null
and preview_url is not null
and thumbnail_url is not null;

create unique index if not exists idx_photos_album_hash_unique
on public.photos(album_id, file_hash)
where file_hash is not null;

drop trigger if exists trg_photos_updated_at on public.photos;
create trigger trg_photos_updated_at
before update on public.photos
for each row execute procedure public.set_updated_at();

-- =========================================================
-- PHOTO JOBS
-- =========================================================

create table if not exists public.photo_jobs (
  id uuid primary key default uuid_generate_v4(),
  photo_id uuid references public.photos(id) on delete cascade,
  album_id uuid references public.albums(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,

  type text not null default 'process',
  original_path text,
  preset_path text,
  size text default 'hd',

  status text default 'pending',
  priority integer default 100,
  progress integer default 0,

  started_at timestamptz,
  finished_at timestamptz,
  error text,

  retry_count integer default 0,
  retries integer default 0,

  worker_id text,

  payload jsonb default '{}'::jsonb,
  metadata jsonb default '{}'::jsonb,
  meta jsonb default '{}'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.photo_jobs
  add column if not exists album_id uuid references public.albums(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists original_path text,
  add column if not exists preset_path text,
  add column if not exists size text default 'hd',
  add column if not exists retry_count integer default 0,
  add column if not exists retries integer default 0,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists meta jsonb default '{}'::jsonb,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_photo_jobs_status on public.photo_jobs(status);
create index if not exists idx_photo_jobs_pending on public.photo_jobs(status, priority, created_at);
create index if not exists idx_photo_jobs_photo on public.photo_jobs(photo_id);
create index if not exists idx_photo_jobs_album_status on public.photo_jobs(album_id, status, priority, created_at);

drop trigger if exists trg_photo_jobs_updated_at on public.photo_jobs;
create trigger trg_photo_jobs_updated_at
before update on public.photo_jobs
for each row execute procedure public.set_updated_at();

-- =========================================================
-- FACE JOBS
-- =========================================================

create table if not exists public.face_jobs (
  id uuid primary key default uuid_generate_v4(),
  photo_id uuid references public.photos(id) on delete cascade,
  album_id uuid references public.albums(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,

  image_path text,
  image_url text,

  status text default 'pending',
  priority integer default 100,
  progress integer default 0,

  error text,
  started_at timestamptz,
  finished_at timestamptz,

  retry_count integer default 0,
  retries integer default 0,

  payload jsonb default '{}'::jsonb,
  metadata jsonb default '{}'::jsonb,
  meta jsonb default '{}'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.face_jobs
  add column if not exists album_id uuid references public.albums(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists image_path text,
  add column if not exists image_url text,
  add column if not exists priority integer default 100,
  add column if not exists retry_count integer default 0,
  add column if not exists retries integer default 0,
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists meta jsonb default '{}'::jsonb,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_face_jobs_status on public.face_jobs(status);
create index if not exists idx_face_jobs_pending on public.face_jobs(status, priority, created_at);
create index if not exists idx_face_jobs_photo on public.face_jobs(photo_id);
create index if not exists idx_face_jobs_album_status on public.face_jobs(album_id, status, priority, created_at);

drop trigger if exists trg_face_jobs_updated_at on public.face_jobs;
create trigger trg_face_jobs_updated_at
before update on public.face_jobs
for each row execute procedure public.set_updated_at();

-- =========================================================
-- PHOTO FACES
-- =========================================================

create table if not exists public.photo_faces (
  id uuid primary key default uuid_generate_v4(),
  photo_id uuid not null references public.photos(id) on delete cascade,
  album_id uuid references public.albums(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,

  face_index integer default 0,

  x double precision,
  y double precision,
  width double precision,
  height double precision,

  box_x double precision,
  box_y double precision,
  box_width double precision,
  box_height double precision,

  box jsonb,
  descriptor jsonb,
  embedding jsonb,

  confidence double precision,

  cluster_id uuid,
  person_cluster_id uuid,

  metadata jsonb default '{}'::jsonb,

  created_at timestamptz default now()
);

alter table public.photo_faces
  add column if not exists album_id uuid references public.albums(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists face_index integer default 0,
  add column if not exists box_x double precision,
  add column if not exists box_y double precision,
  add column if not exists box_width double precision,
  add column if not exists box_height double precision,
  add column if not exists box jsonb,
  add column if not exists descriptor jsonb,
  add column if not exists embedding jsonb,
  add column if not exists person_cluster_id uuid,
  add column if not exists metadata jsonb default '{}'::jsonb;

create index if not exists idx_photo_faces_photo on public.photo_faces(photo_id);
create index if not exists idx_photo_faces_album on public.photo_faces(album_id);
create index if not exists idx_photo_faces_album_owner on public.photo_faces(album_id, owner_id);
create index if not exists idx_photo_faces_confidence on public.photo_faces(confidence desc);

-- =========================================================
-- FACE EMBEDDINGS / CLUSTERS
-- =========================================================

create table if not exists public.face_embeddings (
  id uuid primary key default uuid_generate_v4(),
  face_id uuid not null references public.photo_faces(id) on delete cascade,
  embedding jsonb not null,
  created_at timestamptz default now()
);

create table if not exists public.face_clusters (
  id uuid primary key default uuid_generate_v4(),
  album_id uuid references public.albums(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  label text,
  preview_photo_id uuid references public.photos(id),
  face_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.face_clusters
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists updated_at timestamptz default now();

drop trigger if exists trg_face_clusters_updated_at on public.face_clusters;
create trigger trg_face_clusters_updated_at
before update on public.face_clusters
for each row execute procedure public.set_updated_at();

-- =========================================================
-- WORKER LOGS / HEARTBEATS
-- =========================================================

create table if not exists public.worker_logs (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid,
  photo_id uuid references public.photos(id) on delete set null,
  album_id uuid references public.albums(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  worker_type text,
  level text default 'info',
  message text,
  metadata jsonb default '{}'::jsonb,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.worker_logs
  add column if not exists job_id uuid,
  add column if not exists photo_id uuid references public.photos(id) on delete set null,
  add column if not exists album_id uuid references public.albums(id) on delete set null,
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists meta jsonb default '{}'::jsonb;

create index if not exists idx_worker_logs_photo on public.worker_logs(photo_id);
create index if not exists idx_worker_logs_created on public.worker_logs(created_at desc);

create table if not exists public.worker_heartbeats (
  worker_id text primary key,
  worker_name text,
  worker_type text,
  status text default 'online',
  last_seen timestamptz default now(),
  last_seen_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb,
  meta jsonb default '{}'::jsonb
);

alter table public.worker_heartbeats
  add column if not exists worker_name text,
  add column if not exists status text default 'online',
  add column if not exists last_seen_at timestamptz default now(),
  add column if not exists meta jsonb default '{}'::jsonb;

-- =========================================================
-- RPC: VIEW COUNTERS
-- =========================================================

create or replace function public.increment_photo_views(photo_uuid uuid)
returns void
language plpgsql
as $$
begin
  update public.photos
  set view_count = coalesce(view_count, 0) + 1
  where id = photo_uuid;
end;
$$;

create or replace function public.increment_album_views(album_id uuid)
returns void
language plpgsql
as $$
begin
  update public.albums
  set view_count = coalesce(view_count, 0) + 1
  where id = album_id;
end;
$$;

-- =========================================================
-- RPC: DISTRIBUTED WORKER LOCK
-- =========================================================

create or replace function public.claim_photo_jobs(
  claim_limit integer default 3,
  claim_batch integer default 12,
  max_per_album integer default 2
)
returns table (
  id uuid,
  photo_id uuid,
  album_id uuid,
  owner_id uuid,
  type text,
  original_path text,
  preset_path text,
  size text,
  status text,
  priority integer,
  progress integer,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  retry_count integer,
  retries integer,
  worker_id text,
  payload jsonb,
  metadata jsonb,
  meta jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
  with candidate_jobs as (
    select pj.*
    from public.photo_jobs pj
    where pj.status = 'pending'
    order by pj.priority asc, pj.created_at asc
    limit claim_batch
    for update skip locked
  ),
  ranked_jobs as (
    select
      cj.*,
      row_number() over (
        partition by coalesce(cj.album_id::text, 'unknown')
        order by cj.priority asc, cj.created_at asc
      ) as album_rank
    from candidate_jobs cj
  ),
  selected_jobs as (
    select rj.id
    from ranked_jobs rj
    where rj.album_rank <= max_per_album
    order by rj.priority asc, rj.created_at asc
    limit claim_limit
  ),
  claimed as (
    update public.photo_jobs pj
    set
      status = 'processing',
      progress = 5,
      started_at = now(),
      finished_at = null,
      error = null,
      updated_at = now()
    where pj.id in (select selected_jobs.id from selected_jobs)
    returning pj.*
  )
  select
    claimed.id,
    claimed.photo_id,
    claimed.album_id,
    claimed.owner_id,
    claimed.type,
    claimed.original_path,
    claimed.preset_path,
    claimed.size,
    claimed.status,
    claimed.priority,
    claimed.progress,
    claimed.started_at,
    claimed.finished_at,
    claimed.error,
    claimed.retry_count,
    claimed.retries,
    claimed.worker_id,
    claimed.payload,
    claimed.metadata,
    claimed.meta,
    claimed.created_at,
    claimed.updated_at
  from claimed;
end;
$$;

grant execute on function public.claim_photo_jobs(integer, integer, integer) to authenticated;
grant execute on function public.claim_photo_jobs(integer, integer, integer) to service_role;

create or replace function public.claim_face_jobs(
  claim_limit integer default 1,
  claim_batch integer default 4,
  max_per_album integer default 1
)
returns setof public.face_jobs
language plpgsql
security definer
as $$
begin
  return query
  with candidate_jobs as (
    select *
    from public.face_jobs
    where status = 'pending'
    order by priority asc, created_at asc
    limit claim_batch
    for update skip locked
  ),
  ranked_jobs as (
    select
      *,
      row_number() over (
        partition by coalesce(album_id::text, 'unknown')
        order by priority asc, created_at asc
      ) as album_rank
    from candidate_jobs
  ),
  selected_jobs as (
    select id
    from ranked_jobs
    where album_rank <= max_per_album
    order by priority asc, created_at asc
    limit claim_limit
  )
  update public.face_jobs
  set
    status = 'processing',
    progress = 5,
    started_at = now(),
    finished_at = null,
    error = null,
    updated_at = now()
  where id in (select id from selected_jobs)
  returning *;
end;
$$;

grant execute on function public.claim_photo_jobs(integer, integer, integer) to authenticated;
grant execute on function public.claim_photo_jobs(integer, integer, integer) to service_role;
grant execute on function public.claim_face_jobs(integer, integer, integer) to authenticated;
grant execute on function public.claim_face_jobs(integer, integer, integer) to service_role;

-- =========================================================
-- STORAGE RECALCULATE
-- =========================================================

create or replace function public.recalculate_user_storage(user_uuid uuid)
returns void
language plpgsql
as $$
declare
  total_used bigint;
  total_photos integer;
  total_albums integer;
begin
  select coalesce(sum(file_size_bytes), 0), count(*)
  into total_used, total_photos
  from public.photos
  where coalesce(owner_id, user_id) = user_uuid;

  select count(*)
  into total_albums
  from public.albums
  where coalesce(owner_id, user_id) = user_uuid;

  insert into public.user_storage_usage (
    user_id,
    used_bytes,
    storage_used_bytes,
    photo_count,
    photos_count,
    albums_count,
    updated_at
  )
  values (
    user_uuid,
    total_used,
    total_used,
    total_photos,
    total_photos,
    total_albums,
    now()
  )
  on conflict (user_id)
  do update set
    used_bytes = excluded.used_bytes,
    storage_used_bytes = excluded.storage_used_bytes,
    photo_count = excluded.photo_count,
    photos_count = excluded.photos_count,
    albums_count = excluded.albums_count,
    updated_at = now();
end;
$$;

create or replace function public.update_storage_after_photo_insert()
returns trigger
language plpgsql
as $$
declare
  uid uuid;
begin
  uid := coalesce(new.owner_id, new.user_id);

  if uid is null then
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
    coalesce(new.file_size_bytes, 0),
    coalesce(new.file_size_bytes, 0),
    1,
    1,
    now()
  )
  on conflict (user_id)
  do update set
    used_bytes = public.user_storage_usage.used_bytes + coalesce(new.file_size_bytes, 0),
    storage_used_bytes = public.user_storage_usage.storage_used_bytes + coalesce(new.file_size_bytes, 0),
    photo_count = public.user_storage_usage.photo_count + 1,
    photos_count = public.user_storage_usage.photos_count + 1,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_photo_insert_storage on public.photos;
create trigger trg_photo_insert_storage
after insert on public.photos
for each row execute procedure public.update_storage_after_photo_insert();

create or replace function public.update_storage_after_photo_delete()
returns trigger
language plpgsql
as $$
declare
  uid uuid;
begin
  uid := coalesce(old.owner_id, old.user_id);

  if uid is null then
    return old;
  end if;

  update public.user_storage_usage
  set
    used_bytes = greatest(0, used_bytes - coalesce(old.file_size_bytes, 0)),
    storage_used_bytes = greatest(0, storage_used_bytes - coalesce(old.file_size_bytes, 0)),
    photo_count = greatest(0, photo_count - 1),
    photos_count = greatest(0, photos_count - 1),
    updated_at = now()
  where user_id = uid;

  return old;
end;
$$;

drop trigger if exists trg_photo_delete_storage on public.photos;
create trigger trg_photo_delete_storage
after delete on public.photos
for each row execute procedure public.update_storage_after_photo_delete();

create or replace function public.update_storage_after_photo_size_update()
returns trigger
language plpgsql
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
    storage_used_bytes = greatest(0, public.user_storage_usage.storage_used_bytes + diff),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_photo_size_update_storage on public.photos;
create trigger trg_photo_size_update_storage
after update of file_size_bytes on public.photos
for each row execute procedure public.update_storage_after_photo_size_update();

-- =========================================================
-- STORAGE BUCKET
-- =========================================================

insert into storage.buckets (id, name, public)
values ('albums', 'albums', true)
on conflict (id) do nothing;

-- =========================================================
-- RLS
-- =========================================================

alter table public.albums enable row level security;
alter table public.photos enable row level security;
alter table public.categories enable row level security;
alter table public.photo_jobs enable row level security;
alter table public.face_jobs enable row level security;
alter table public.photo_faces enable row level security;

drop policy if exists "albums_select_own" on public.albums;
drop policy if exists "albums_insert_own" on public.albums;
drop policy if exists "albums_update_own" on public.albums;
drop policy if exists "albums_delete_own" on public.albums;
drop policy if exists "albums_public_share_select" on public.albums;

drop policy if exists "photos_select_own" on public.photos;
drop policy if exists "photos_insert_own" on public.photos;
drop policy if exists "photos_update_own" on public.photos;
drop policy if exists "photos_delete_own" on public.photos;
drop policy if exists "photos_public_share_select" on public.photos;

drop policy if exists "categories_select_own" on public.categories;
drop policy if exists "categories_insert_own" on public.categories;

drop policy if exists "photo_faces_owner_select" on public.photo_faces;
drop policy if exists "photo_faces_public_share_select" on public.photo_faces;

create policy "albums_select_own"
on public.albums
for select
using (auth.uid() = coalesce(owner_id, user_id));

create policy "albums_insert_own"
on public.albums
for insert
with check (auth.uid() = coalesce(owner_id, user_id));

create policy "albums_update_own"
on public.albums
for update
using (auth.uid() = coalesce(owner_id, user_id));

create policy "albums_delete_own"
on public.albums
for delete
using (auth.uid() = coalesce(owner_id, user_id));

create policy "albums_public_share_select"
on public.albums
for select
using (
  share_token is not null
  and coalesce(status, 'active') = 'active'
);

create policy "photos_select_own"
on public.photos
for select
using (auth.uid() = coalesce(owner_id, user_id));

create policy "photos_insert_own"
on public.photos
for insert
with check (auth.uid() = coalesce(owner_id, user_id));

create policy "photos_update_own"
on public.photos
for update
using (auth.uid() = coalesce(owner_id, user_id));

create policy "photos_delete_own"
on public.photos
for delete
using (auth.uid() = coalesce(owner_id, user_id));

create policy "photos_public_share_select"
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
    and albums.share_token is not null
    and coalesce(albums.status, 'active') = 'active'
  )
);

create policy "categories_select_own"
on public.categories
for select
using (
  exists (
    select 1
    from public.albums
    where albums.id = categories.album_id
    and auth.uid() = coalesce(albums.owner_id, albums.user_id)
  )
);

create policy "categories_insert_own"
on public.categories
for insert
with check (
  exists (
    select 1
    from public.albums
    where albums.id = categories.album_id
    and auth.uid() = coalesce(albums.owner_id, albums.user_id)
  )
);

create policy "photo_faces_owner_select"
on public.photo_faces
for select
using (auth.uid() = owner_id);

create policy "photo_faces_public_share_select"
on public.photo_faces
for select
using (
  exists (
    select 1
    from public.photos
    join public.albums on albums.id = photos.album_id
    where photos.id = photo_faces.photo_id
    and photos.processing_status = 'done'
    and albums.share_token is not null
    and coalesce(albums.status, 'active') = 'active'
  )
);


-- =========================================================
-- CAMERA SYSTEM TABLES
-- =========================================================

create table if not exists public.camera_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  album_id uuid not null references public.albums(id) on delete cascade,
  camera_brand text,
  camera_model text,
  camera_name text,
  serial_number text,
  status text not null default 'disconnected',
  battery_percent integer,
  storage_remaining_gb numeric,
  auto_import boolean not null default true,
  auto_apply_xmp boolean not null default true,
  auto_face_ai boolean not null default true,
  auto_resize boolean not null default true,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.camera_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  preset_path text,
  resize_mode text not null default 'original',
  auto_face_scan boolean not null default true,
  auto_publish boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.camera_live_imports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.camera_upload_sessions(id) on delete cascade,
  album_id uuid not null references public.albums(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  camera_file_id text,
  filename text not null,
  local_path text,
  storage_path text,
  file_size_bytes bigint default 0,
  status text not null default 'pending',
  progress integer not null default 0,
  error text,
  detected_at timestamptz not null default now(),
  imported_at timestamptz,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_camera_sessions_album
on public.camera_sessions(album_id);

create index if not exists idx_camera_upload_sessions_album
on public.camera_upload_sessions(album_id);

create index if not exists idx_camera_upload_sessions_status
on public.camera_upload_sessions(status);

create index if not exists idx_camera_live_imports_album
on public.camera_live_imports(album_id);

create index if not exists idx_camera_live_imports_status
on public.camera_live_imports(status);

create unique index if not exists idx_camera_live_imports_unique_file
on public.camera_live_imports(album_id, camera_file_id);

-- =========================================================
-- STORAGE POLICIES
-- =========================================================

drop policy if exists "album_storage_public_read" on storage.objects;
drop policy if exists "album_storage_auth_upload" on storage.objects;
drop policy if exists "album_storage_auth_update" on storage.objects;
drop policy if exists "album_storage_auth_delete" on storage.objects;

create policy "album_storage_public_read"
on storage.objects
for select
using (bucket_id = 'albums');

create policy "album_storage_auth_upload"
on storage.objects
for insert
with check (
  bucket_id = 'albums'
  and auth.role() = 'authenticated'
);

create policy "album_storage_auth_update"
on storage.objects
for update
using (
  bucket_id = 'albums'
  and auth.role() = 'authenticated'
);

create policy "album_storage_auth_delete"
on storage.objects
for delete
using (
  bucket_id = 'albums'
  and auth.role() = 'authenticated'
);

-- =========================================================
-- V25.1 SCHEMA ALIGNMENT
-- Align database columns with current app code
-- =========================================================

-- PLANS: pricing / ordering fields used by pricing page
alter table public.plans
  add column if not exists price numeric default 0,
  add column if not exists price_thb integer default 0,
  add column if not exists sort_order integer default 0;

create index if not exists idx_plans_sort_order
on public.plans(sort_order);

-- ALBUMS: upload defaults / camera settings used by create album and upload modal
alter table public.albums
  add column if not exists upload_mode text default 'manual',
  add column if not exists upload_size text default 'uhd',
  add column if not exists upload_profile text default 'professional',
  add column if not exists album_preset_path text,
  add column if not exists auto_publish boolean default true,
  add column if not exists auto_face_scan boolean default true,
  add column if not exists camera_status text default 'inactive',
  add column if not exists camera_connection_type text;

-- CAMERA UPLOAD SESSIONS: used by V25.1 camera worker session timeout
alter table public.camera_upload_sessions
  add column if not exists last_activity_at timestamptz default now();

create index if not exists idx_camera_upload_sessions_activity
on public.camera_upload_sessions(last_activity_at);

-- USER STORAGE USAGE: used by change-plan / billing downgrade flow
alter table public.user_storage_usage
  add column if not exists pending_plan text,
  add column if not exists downgrade_scheduled_at timestamptz,
  add column if not exists current_period_end timestamptz;

-- =========================================================
-- DEFAULT PLANS
-- =========================================================

insert into public.plans (
  name,
  slug,
  storage_limit_bytes,
  price,
  price_thb,
  sort_order,
  is_active
)
values
  ('Free', 'free', 5368709120, 0, 0, 1, true),
  ('Starter 20GB', 'starter', 21474836480, 299, 299, 2, true),
  ('Pro 50GB', 'pro', 53687091200, 499, 499, 3, true),
  ('Business 100GB', 'business', 107374182400, 699, 699, 4, true)
on conflict (slug) do update set
  name = excluded.name,
  storage_limit_bytes = excluded.storage_limit_bytes,
  price = excluded.price,
  price_thb = excluded.price_thb,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

-- =========================================================
-- DONE FULL SCHEMA v2.1
-- =========================================================