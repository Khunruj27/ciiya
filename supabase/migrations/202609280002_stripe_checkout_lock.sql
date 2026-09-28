-- Serialize subscription Checkout creation per Ciiya user and Stripe mode.
-- This closes the window where different plans are opened concurrently before
-- Stripe has created a Subscription that can be discovered remotely.

begin;

create table if not exists public.stripe_checkout_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_mode text not null check (stripe_mode in ('test', 'live')),
  plan_id uuid not null references public.plans(id),
  attempt_token uuid not null default gen_random_uuid(),
  status text not null default 'processing'
    check (status in ('processing', 'open', 'completed', 'failed')),
  stripe_checkout_session_id text,
  processing_started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, stripe_mode)
);

create unique index if not exists idx_stripe_checkout_attempt_session
on public.stripe_checkout_attempts(stripe_checkout_session_id)
where stripe_checkout_session_id is not null;

alter table public.stripe_checkout_attempts enable row level security;

-- Checkout attempt IDs are operational billing data. Browser clients receive
-- only the resulting Stripe URL and cannot read or mutate this table.
revoke all on table public.stripe_checkout_attempts
  from public, anon, authenticated;
grant all privileges on table public.stripe_checkout_attempts to service_role;

create or replace function public.claim_stripe_checkout_attempt(
  p_user_id uuid,
  p_stripe_mode text,
  p_plan_id uuid,
  p_expires_at timestamptz,
  p_stale_after interval default interval '10 minutes'
)
returns table (
  claimed boolean,
  attempt_token uuid,
  attempt_status text,
  existing_plan_id uuid,
  stripe_checkout_session_id text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_token uuid;
  v_status text;
  v_plan_id uuid;
  v_session_id text;
  v_expires_at timestamptz;
begin
  if p_user_id is null
    or p_plan_id is null
    or p_stripe_mode not in ('test', 'live')
    or p_expires_at is null
    or p_expires_at <= now() + interval '30 minutes'
    or p_expires_at > now() + interval '24 hours'
    or p_stale_after is null
    or p_stale_after <= interval '0 seconds'
  then
    raise exception using
      errcode = '22023',
      message = 'INVALID_STRIPE_CHECKOUT_ATTEMPT';
  end if;

  insert into public.stripe_checkout_attempts as a (
    user_id,
    stripe_mode,
    plan_id,
    attempt_token,
    status,
    processing_started_at,
    expires_at,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    p_stripe_mode,
    p_plan_id,
    gen_random_uuid(),
    'processing',
    now(),
    p_expires_at,
    now(),
    now()
  )
  on conflict (user_id, stripe_mode) do nothing
  returning a.attempt_token, a.expires_at into v_token, v_expires_at;

  if found then
    return query
      select true, v_token, 'processing'::text, p_plan_id, null::text,
        v_expires_at;
    return;
  end if;

  -- A failed attempt can start over with a new immutable request fingerprint.
  -- Open Sessions are never replaced here, even if the database expiry passed:
  -- the application must retrieve and reconcile the exact Stripe Session first.
  update public.stripe_checkout_attempts as a
  set
    plan_id = p_plan_id,
    attempt_token = gen_random_uuid(),
    status = 'processing',
    stripe_checkout_session_id = null,
    processing_started_at = now(),
    expires_at = p_expires_at,
    updated_at = now()
  where a.user_id = p_user_id
    and a.stripe_mode = p_stripe_mode
    and a.status = 'failed'
  returning a.attempt_token, a.expires_at into v_token, v_expires_at;

  if found then
    return query
      select true, v_token, 'processing'::text, p_plan_id, null::text,
        v_expires_at;
    return;
  end if;

  -- A processing request can be safely replaced after its persisted Stripe
  -- expiry. This bounds different-plan locks without guessing whether an
  -- interrupted network request reached Stripe.
  update public.stripe_checkout_attempts as a
  set
    plan_id = p_plan_id,
    attempt_token = gen_random_uuid(),
    status = 'processing',
    stripe_checkout_session_id = null,
    processing_started_at = now(),
    expires_at = p_expires_at,
    updated_at = now()
  where a.user_id = p_user_id
    and a.stripe_mode = p_stripe_mode
    and a.status = 'processing'
    and a.expires_at <= now()
  returning a.attempt_token, a.expires_at into v_token, v_expires_at;

  if found then
    return query
      select true, v_token, 'processing'::text, p_plan_id, null::text,
        v_expires_at;
    return;
  end if;

  -- If a request died around Stripe session creation, retry the same plan with
  -- the same token. Stripe idempotency then returns the original Session rather
  -- than creating a second subscription.
  update public.stripe_checkout_attempts as a
  set
    processing_started_at = now(),
    updated_at = now()
  where a.user_id = p_user_id
    and a.stripe_mode = p_stripe_mode
    and a.plan_id = p_plan_id
    and a.status = 'processing'
    and a.expires_at > now()
    and a.processing_started_at <= now() - p_stale_after
  returning a.attempt_token, a.expires_at into v_token, v_expires_at;

  if found then
    return query
      select true, v_token, 'processing'::text, p_plan_id, null::text,
        v_expires_at;
    return;
  end if;

  select
    a.attempt_token,
    a.status,
    a.plan_id,
    a.stripe_checkout_session_id,
    a.expires_at
  into v_token, v_status, v_plan_id, v_session_id, v_expires_at
  from public.stripe_checkout_attempts as a
  where a.user_id = p_user_id
    and a.stripe_mode = p_stripe_mode;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'STRIPE_CHECKOUT_ATTEMPT_NOT_FOUND';
  end if;

  return query
    select false, v_token, v_status, v_plan_id, v_session_id, v_expires_at;
end;
$function$;

create or replace function public.open_stripe_checkout_attempt(
  p_user_id uuid,
  p_stripe_mode text,
  p_attempt_token uuid,
  p_session_id text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row_count bigint;
begin
  if p_session_id is null
    or char_length(p_session_id) not between 1 and 255
    or p_expires_at is null
    or p_expires_at <= now()
  then
    raise exception using
      errcode = '22023',
      message = 'INVALID_STRIPE_CHECKOUT_SESSION';
  end if;

  update public.stripe_checkout_attempts as a
  set
    status = 'open',
    stripe_checkout_session_id = p_session_id,
    expires_at = p_expires_at,
    updated_at = now()
  where a.user_id = p_user_id
    and a.stripe_mode = p_stripe_mode
    and a.attempt_token = p_attempt_token
    and a.status = 'processing';

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$function$;

create or replace function public.fail_stripe_checkout_attempt(
  p_user_id uuid,
  p_stripe_mode text,
  p_attempt_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row_count bigint;
begin
  update public.stripe_checkout_attempts as a
  set
    status = 'failed',
    updated_at = now()
  where a.user_id = p_user_id
    and a.stripe_mode = p_stripe_mode
    and a.attempt_token = p_attempt_token
    and a.status = 'processing';

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$function$;

create or replace function public.complete_stripe_checkout_attempt(
  p_user_id uuid,
  p_stripe_mode text,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row_count bigint;
begin
  update public.stripe_checkout_attempts as a
  set
    status = 'completed',
    updated_at = now()
  where a.user_id = p_user_id
    and a.stripe_mode = p_stripe_mode
    and a.stripe_checkout_session_id = p_session_id
    and a.status in ('processing', 'open', 'completed');

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$function$;

create or replace function public.expire_stripe_checkout_attempt(
  p_user_id uuid,
  p_stripe_mode text,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row_count bigint;
begin
  update public.stripe_checkout_attempts as a
  set
    status = 'failed',
    expires_at = coalesce(a.expires_at, now()),
    updated_at = now()
  where a.user_id = p_user_id
    and a.stripe_mode = p_stripe_mode
    and a.stripe_checkout_session_id = p_session_id
    and a.status in ('open', 'failed');

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$function$;

create or replace function public.retire_terminal_stripe_checkout_attempt(
  p_user_id uuid,
  p_stripe_mode text,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row_count bigint;
begin
  if p_user_id is null
    or p_stripe_mode is null
    or p_stripe_mode not in ('test', 'live')
    or p_session_id is null
    or char_length(p_session_id) not between 1 and 255
  then
    raise exception using
      errcode = '22023',
      message = 'INVALID_TERMINAL_STRIPE_CHECKOUT_ATTEMPT';
  end if;

  -- The application must verify the exact Stripe Subscription is canceled or
  -- incomplete_expired immediately before calling this atomic exact-row delete.
  delete from public.stripe_checkout_attempts as a
  where a.user_id = p_user_id
    and a.stripe_mode = p_stripe_mode
    and a.stripe_checkout_session_id = p_session_id
    and a.status in ('open', 'completed');

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$function$;

revoke all on function public.claim_stripe_checkout_attempt(
  uuid,
  text,
  uuid,
  timestamptz,
  interval
) from public, anon, authenticated;
revoke all on function public.open_stripe_checkout_attempt(
  uuid,
  text,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.fail_stripe_checkout_attempt(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_stripe_checkout_attempt(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.expire_stripe_checkout_attempt(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.retire_terminal_stripe_checkout_attempt(
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.claim_stripe_checkout_attempt(
  uuid,
  text,
  uuid,
  timestamptz,
  interval
) to service_role;
grant execute on function public.open_stripe_checkout_attempt(
  uuid,
  text,
  uuid,
  text,
  timestamptz
) to service_role;
grant execute on function public.fail_stripe_checkout_attempt(uuid, text, uuid)
  to service_role;
grant execute on function public.complete_stripe_checkout_attempt(uuid, text, text)
  to service_role;
grant execute on function public.expire_stripe_checkout_attempt(uuid, text, text)
  to service_role;
grant execute on function public.retire_terminal_stripe_checkout_attempt(
  uuid,
  text,
  text
) to service_role;

notify pgrst, 'reload schema';

commit;
