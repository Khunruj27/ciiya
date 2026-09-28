-- Reconcile each Stripe subscription snapshot and the user's effective storage
-- entitlement in one serialized transaction. Stripe events can be delivered
-- concurrently or out of order, so both subscription state and paid-entitlement
-- decisions carry independent event fences.

begin;

alter table public.subscriptions
  add column if not exists stripe_state_event_created_at timestamptz,
  add column if not exists stripe_state_event_id text,
  add column if not exists entitlement_plan_id uuid
    references public.plans(id) on delete restrict,
  add column if not exists entitlement_event_created_at timestamptz,
  add column if not exists entitlement_event_id text;

alter table public.user_storage_usage
  add column if not exists pending_plan text,
  add column if not exists downgrade_scheduled_at timestamptz,
  add column if not exists current_period_end timestamptz;

-- Preserve entitlements that predate event fencing. Non-entitled Stripe states
-- intentionally remain without entitlement_plan_id and reconcile to Free unless
-- another eligible subscription exists.
update public.subscriptions
set stripe_state_event_created_at = coalesce(
      stripe_state_event_created_at,
      updated_at,
      created_at,
      now()
    ),
    stripe_state_event_id = coalesce(
      stripe_state_event_id,
      'legacy:' || id::text
    ),
    entitlement_plan_id = case
      when status in ('active', 'trialing', 'past_due')
        then coalesce(entitlement_plan_id, plan_id)
      else null
    end,
    entitlement_event_created_at = case
      when status in ('active', 'trialing', 'past_due')
        then coalesce(
          entitlement_event_created_at,
          updated_at,
          created_at,
          now()
        )
      else entitlement_event_created_at
    end,
    entitlement_event_id = case
      when status in ('active', 'trialing', 'past_due')
        then coalesce(entitlement_event_id, 'legacy:' || id::text)
      else entitlement_event_id
    end
where stripe_subscription_id is not null;

create index if not exists idx_subscriptions_effective_entitlement
on public.subscriptions(
  user_id,
  stripe_mode,
  entitlement_event_created_at desc,
  current_period_end desc
)
where entitlement_plan_id is not null
  and status in ('active', 'trialing', 'past_due');

create or replace function public.reconcile_stripe_subscription_entitlement(
  p_user_id uuid,
  p_stripe_mode text,
  p_subscription_id text,
  p_customer_id text,
  p_plan_id uuid,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_event_created_at timestamptz,
  p_event_id text,
  p_grant_entitlement boolean
)
returns table (
  state_applied boolean,
  entitlement_applied boolean,
  effective_plan text,
  effective_subscription_id text,
  eligible_subscription_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_existing public.subscriptions%rowtype;
  v_current public.subscriptions%rowtype;
  v_state_applied boolean := false;
  v_entitlement_applied boolean := false;
  v_incoming_rank integer;
  v_existing_rank integer;
  v_effective_plan text;
  v_effective_subscription_id text;
  v_effective_storage_limit bigint;
  v_effective_period_end timestamptz;
  v_eligible_count integer := 0;
  v_effective_mode text;
begin
  if p_user_id is null
    or p_stripe_mode is null
    or p_stripe_mode not in ('test', 'live')
    or p_subscription_id is null
    or char_length(p_subscription_id) not between 1 and 255
    or p_status is null
    or p_status not in (
      'active',
      'trialing',
      'past_due',
      'paused',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'canceled'
    )
    or p_event_created_at is null
    or p_event_id is null
    or char_length(p_event_id) not between 1 and 255
    or p_grant_entitlement is null
  then
    raise exception using
      errcode = '22023',
      message = 'INVALID_STRIPE_ENTITLEMENT_RECONCILIATION';
  end if;

  if p_status in ('active', 'trialing', 'past_due') and p_plan_id is null then
    raise exception using
      errcode = '22023',
      message = 'STRIPE_ENTITLEMENT_PLAN_REQUIRED';
  end if;

  -- user_storage_usage has one row per user, shared by Test and Live. Serialize
  -- across both Stripe modes so a late Test webhook cannot race a Live event.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select s.*
  into v_existing
  from public.subscriptions as s
  where s.stripe_subscription_id = p_subscription_id
  for update;

  if found
    and (
      v_existing.user_id is distinct from p_user_id
      or v_existing.stripe_mode is distinct from p_stripe_mode
    )
  then
    raise exception using
      errcode = '23514',
      message = 'STRIPE_SUBSCRIPTION_OWNERSHIP_MISMATCH';
  end if;

  v_incoming_rank := case
    when p_status in ('canceled', 'incomplete_expired') then 4
    when p_status in ('paused', 'unpaid', 'incomplete') then 3
    when p_status = 'past_due' then 2
    else 1
  end;

  v_existing_rank := case
    when v_existing.status in ('canceled', 'incomplete_expired') then 4
    when v_existing.status in ('paused', 'unpaid', 'incomplete') then 3
    when v_existing.status = 'past_due' then 2
    else 1
  end;

  if v_existing.id is null then
    insert into public.subscriptions (
      user_id,
      plan_id,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_mode,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      stripe_state_event_created_at,
      stripe_state_event_id
    ) values (
      p_user_id,
      p_plan_id,
      p_customer_id,
      p_subscription_id,
      p_stripe_mode,
      p_status,
      p_current_period_start,
      p_current_period_end,
      coalesce(p_cancel_at_period_end, false),
      p_event_created_at,
      p_event_id
    )
    returning * into v_current;

    v_state_applied := true;
  else
    -- canceled and incomplete_expired are irreversible for a Stripe
    -- subscription ID. An incoming terminal snapshot always defeats a stored
    -- non-terminal snapshot, even if a concurrent stale handler obtained a
    -- later event timestamp. Other transitions use timestamp/risk/id fencing.
    v_state_applied :=
      (
        p_status in ('canceled', 'incomplete_expired')
        and v_existing.status not in ('canceled', 'incomplete_expired')
      )
      or (
        not (
          v_existing.status in ('canceled', 'incomplete_expired')
          and p_status not in ('canceled', 'incomplete_expired')
        )
        and (
          v_existing.stripe_state_event_created_at is null
          or p_event_created_at > v_existing.stripe_state_event_created_at
          or (
            p_event_created_at = v_existing.stripe_state_event_created_at
            and (
              v_incoming_rank > v_existing_rank
              or (
                v_incoming_rank = v_existing_rank
                and p_event_id >= coalesce(v_existing.stripe_state_event_id, '')
              )
            )
          )
        )
      );

    if v_state_applied then
      update public.subscriptions as s
      set plan_id = coalesce(p_plan_id, s.plan_id),
          stripe_customer_id = coalesce(p_customer_id, s.stripe_customer_id),
          status = p_status,
          current_period_start = coalesce(
            p_current_period_start,
            s.current_period_start
          ),
          current_period_end = coalesce(
            p_current_period_end,
            s.current_period_end
          ),
          cancel_at_period_end = coalesce(
            p_cancel_at_period_end,
            s.cancel_at_period_end
          ),
          stripe_state_event_created_at = p_event_created_at,
          stripe_state_event_id = p_event_id
      where s.id = v_existing.id
      returning * into v_current;
    else
      v_current := v_existing;
    end if;
  end if;

  -- Entitlement policy:
  --   * active/trialing may newly grant only with paid-event evidence;
  --   * past_due retains an existing paid entitlement during dunning grace;
  --   * paused/unpaid/incomplete/incomplete_expired/canceled revoke it.
  if v_state_applied
    and v_current.status in (
      'paused',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'canceled'
    )
  then
    update public.subscriptions as s
    set entitlement_plan_id = null,
        entitlement_event_created_at = p_event_created_at,
        entitlement_event_id = p_event_id
    where s.id = v_current.id
    returning * into v_current;

    v_entitlement_applied := true;
  elsif p_grant_entitlement
    and v_current.status in ('active', 'trialing')
    and v_current.plan_id = p_plan_id
    and (
      v_current.entitlement_event_created_at is null
      or p_event_created_at > v_current.entitlement_event_created_at
      or (
        p_event_created_at = v_current.entitlement_event_created_at
        and p_event_id >= coalesce(v_current.entitlement_event_id, '')
      )
    )
  then
    update public.subscriptions as s
    set entitlement_plan_id = p_plan_id,
        entitlement_event_created_at = p_event_created_at,
        entitlement_event_id = p_event_id
    where s.id = v_current.id
    returning * into v_current;

    v_entitlement_applied := true;
  elsif v_state_applied and v_current.status = 'past_due' then
    -- Do not grant from past_due alone, but advance its entitlement fence so
    -- an older paid event cannot later create entitlement from stale state.
    update public.subscriptions as s
    set entitlement_event_created_at = p_event_created_at,
        entitlement_event_id = p_event_id
    where s.id = v_current.id
    returning * into v_current;

    v_entitlement_applied := true;
  end if;

  -- Once a user has any Live subscription history, only Live rows may drive
  -- their effective entitlement. This prevents old Test deliveries from
  -- restoring a paid Test quota after Live cancellation or payment failure.
  select case
    when exists (
      select 1
      from public.subscriptions as live_subscription
      where live_subscription.user_id = p_user_id
        and live_subscription.stripe_mode = 'live'
        and live_subscription.stripe_subscription_id is not null
    ) then 'live'
    else 'test'
  end
  into v_effective_mode;

  select count(*)::integer
  into v_eligible_count
  from public.subscriptions as s
  where s.user_id = p_user_id
    and s.stripe_mode = v_effective_mode
    and s.status in ('active', 'trialing', 'past_due')
    and s.entitlement_plan_id is not null;

  select
    p.slug,
    s.stripe_subscription_id,
    p.storage_limit_bytes,
    s.current_period_end
  into
    v_effective_plan,
    v_effective_subscription_id,
    v_effective_storage_limit,
    v_effective_period_end
  from public.subscriptions as s
  join public.plans as p on p.id = s.entitlement_plan_id
  where s.user_id = p_user_id
    and s.stripe_mode = v_effective_mode
    and s.status in ('active', 'trialing', 'past_due')
    and s.entitlement_plan_id is not null
  order by
    s.entitlement_event_created_at desc nulls last,
    s.current_period_end desc nulls last,
    s.updated_at desc,
    s.id desc
  limit 1;

  if v_effective_plan is null then
    select p.slug, p.storage_limit_bytes
    into v_effective_plan, v_effective_storage_limit
    from public.plans as p
    where p.slug = 'free'
    limit 1;

    if v_effective_plan is null then
      raise exception using
        errcode = '23514',
        message = 'FREE_PLAN_REQUIRED_FOR_ENTITLEMENT_RECONCILIATION';
    end if;

    v_effective_subscription_id := null;
    v_effective_period_end := null;
  end if;

  insert into public.user_storage_usage as u (
    user_id,
    current_plan,
    storage_limit_bytes,
    pending_plan,
    downgrade_scheduled_at,
    current_period_end,
    updated_at
  ) values (
    p_user_id,
    v_effective_plan,
    v_effective_storage_limit,
    null,
    null,
    v_effective_period_end,
    now()
  )
  on conflict (user_id) do update
  set current_plan = excluded.current_plan,
      storage_limit_bytes = excluded.storage_limit_bytes,
      pending_plan = null,
      downgrade_scheduled_at = null,
      current_period_end = excluded.current_period_end,
      updated_at = excluded.updated_at;

  return query select
    v_state_applied,
    v_entitlement_applied,
    v_effective_plan,
    v_effective_subscription_id,
    v_eligible_count;
end;
$function$;

revoke all on function public.reconcile_stripe_subscription_entitlement(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  timestamptz,
  timestamptz,
  boolean,
  timestamptz,
  text,
  boolean
) from public, anon, authenticated;

grant execute on function public.reconcile_stripe_subscription_entitlement(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  timestamptz,
  timestamptz,
  boolean,
  timestamptz,
  text,
  boolean
) to service_role;

notify pgrst, 'reload schema';

commit;
