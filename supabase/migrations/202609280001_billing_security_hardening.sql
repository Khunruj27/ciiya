-- Lock billing and quota state behind owner-readable RLS. All mutations remain
-- server-only through the service role. The Stripe webhook ledger provides an
-- atomic claim so duplicate deliveries do not apply subscription changes twice,
-- while failed or abandoned claims can be retried safely.

begin;

-- Existing authenticated photo writes maintain quota through these triggers.
-- Run them with the migration owner privileges before removing direct client
-- write access to user_storage_usage.
alter function public.update_storage_after_photo_insert()
  security definer;
alter function public.update_storage_after_photo_insert()
  set search_path = public, pg_temp;

alter function public.update_storage_after_photo_delete()
  security definer;
alter function public.update_storage_after_photo_delete()
  set search_path = public, pg_temp;

alter function public.update_storage_after_asset_change()
  security definer;
alter function public.update_storage_after_asset_change()
  set search_path = public, pg_temp;

alter function public.recalculate_user_storage(uuid)
  security definer;
alter function public.recalculate_user_storage(uuid)
  set search_path = public, pg_temp;

revoke all on function public.update_storage_after_photo_insert()
  from public, anon, authenticated;
revoke all on function public.update_storage_after_photo_delete()
  from public, anon, authenticated;
revoke all on function public.update_storage_after_asset_change()
  from public, anon, authenticated;
revoke all on function public.recalculate_user_storage(uuid)
  from public, anon, authenticated;

grant execute on function public.update_storage_after_photo_insert()
  to service_role;
grant execute on function public.update_storage_after_photo_delete()
  to service_role;
grant execute on function public.update_storage_after_asset_change()
  to service_role;
grant execute on function public.recalculate_user_storage(uuid)
  to service_role;

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.user_storage_usage enable row level security;

drop policy if exists "plans_select_active" on public.plans;
create policy "plans_select_active"
on public.plans
for select
to authenticated
using (is_active is true);

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
on public.subscriptions
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "user_storage_usage_select_own"
  on public.user_storage_usage;
create policy "user_storage_usage_select_own"
on public.user_storage_usage
for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.plans
  from public, anon, authenticated;
revoke all on table public.subscriptions
  from public, anon, authenticated;
revoke all on table public.user_storage_usage
  from public, anon, authenticated;

grant select on table public.plans to authenticated;
grant select on table public.subscriptions to authenticated;
grant select on table public.user_storage_usage to authenticated;

grant all privileges on table public.plans to service_role;
grant all privileges on table public.subscriptions to service_role;
grant all privileges on table public.user_storage_usage to service_role;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  livemode boolean not null,
  status text not null default 'processing',
  attempt_count integer not null default 1,
  processing_started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_webhook_events_event_id_check
    check (char_length(event_id) between 1 and 255),
  constraint stripe_webhook_events_event_type_check
    check (char_length(event_type) between 1 and 255),
  constraint stripe_webhook_events_status_check
    check (status in ('processing', 'completed', 'failed')),
  constraint stripe_webhook_events_attempt_count_check
    check (attempt_count > 0)
);

create index if not exists idx_stripe_webhook_events_retry
on public.stripe_webhook_events(status, processing_started_at)
where status in ('processing', 'failed');

alter table public.stripe_webhook_events enable row level security;

-- Intentionally no client policy: webhook event IDs and failures are private
-- operational data, visible only through the service role.
revoke all on table public.stripe_webhook_events
  from public, anon, authenticated;
grant all privileges on table public.stripe_webhook_events
  to service_role;

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_stale_after interval default interval '10 minutes'
)
returns table (
  claimed boolean,
  event_status text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_attempt_count integer;
  v_event_type text;
  v_livemode boolean;
  v_status text;
begin
  if p_event_id is null
    or char_length(p_event_id) not between 1 and 255
    or p_event_type is null
    or char_length(p_event_type) not between 1 and 255
    or p_livemode is null
  then
    raise exception using
      errcode = '22023',
      message = 'INVALID_STRIPE_WEBHOOK_EVENT';
  end if;

  if p_stale_after is null or p_stale_after <= interval '0 seconds' then
    raise exception using
      errcode = '22023',
      message = 'INVALID_STRIPE_WEBHOOK_STALE_AFTER';
  end if;

  insert into public.stripe_webhook_events as e (
    event_id,
    event_type,
    livemode,
    status,
    attempt_count,
    processing_started_at,
    completed_at,
    failed_at,
    last_error,
    created_at,
    updated_at
  )
  values (
    p_event_id,
    p_event_type,
    p_livemode,
    'processing',
    1,
    now(),
    null,
    null,
    null,
    now(),
    now()
  )
  on conflict (event_id) do nothing
  returning e.attempt_count into v_attempt_count;

  if found then
    return query select true, 'processing'::text, v_attempt_count;
    return;
  end if;

  update public.stripe_webhook_events as e
  set
    status = 'processing',
    attempt_count = e.attempt_count + 1,
    processing_started_at = now(),
    completed_at = null,
    failed_at = null,
    last_error = null,
    updated_at = now()
  where e.event_id = p_event_id
    and e.event_type = p_event_type
    and e.livemode = p_livemode
    and (
      e.status = 'failed'
      or (
        e.status = 'processing'
        and e.processing_started_at <= now() - p_stale_after
      )
    )
  returning e.attempt_count into v_attempt_count;

  if found then
    return query select true, 'processing'::text, v_attempt_count;
    return;
  end if;

  select e.event_type, e.livemode, e.status, e.attempt_count
  into v_event_type, v_livemode, v_status, v_attempt_count
  from public.stripe_webhook_events as e
  where e.event_id = p_event_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'STRIPE_WEBHOOK_EVENT_NOT_FOUND';
  end if;

  if v_event_type is distinct from p_event_type
    or v_livemode is distinct from p_livemode
  then
    raise exception using
      errcode = 'P0001',
      message = 'STRIPE_WEBHOOK_EVENT_MISMATCH';
  end if;

  return query select false, v_status, v_attempt_count;
end;
$function$;

create or replace function public.complete_stripe_webhook_event(
  p_event_id text,
  p_attempt_count integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row_count bigint;
begin
  update public.stripe_webhook_events as e
  set
    status = 'completed',
    completed_at = now(),
    failed_at = null,
    last_error = null,
    updated_at = now()
  where e.event_id = p_event_id
    and e.status = 'processing'
    and e.attempt_count = p_attempt_count;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$function$;

create or replace function public.fail_stripe_webhook_event(
  p_event_id text,
  p_attempt_count integer,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row_count bigint;
begin
  update public.stripe_webhook_events as e
  set
    status = 'failed',
    completed_at = null,
    failed_at = now(),
    last_error = left(coalesce(p_error, 'Unknown webhook error'), 4000),
    updated_at = now()
  where e.event_id = p_event_id
    and e.status = 'processing'
    and e.attempt_count = p_attempt_count;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$function$;

revoke all on function public.claim_stripe_webhook_event(
  text,
  text,
  boolean,
  interval
) from public, anon, authenticated;
revoke all on function public.complete_stripe_webhook_event(text, integer)
  from public, anon, authenticated;
revoke all on function public.fail_stripe_webhook_event(text, integer, text)
  from public, anon, authenticated;

grant execute on function public.claim_stripe_webhook_event(
  text,
  text,
  boolean,
  interval
) to service_role;
grant execute on function public.complete_stripe_webhook_event(text, integer)
  to service_role;
grant execute on function public.fail_stripe_webhook_event(text, integer, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
