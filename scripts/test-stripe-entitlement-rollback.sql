-- Set the session's ciiya.test_owner_id to the approved canary UUID before
-- running this file. All test writes roll back; no Stripe API call is made.
begin;
set local lock_timeout = '5s';
do $test$
declare
  owner_id uuid := current_setting('ciiya.test_owner_id', true)::uuid;
  starter_id uuid;
  before_usage public.user_storage_usage%rowtype;
  after_usage public.user_storage_usage%rowtype;
  result record;
  event_time timestamptz := now();
  test_sub text := 'sub_ciiya_rollback_' || replace(gen_random_uuid()::text, '-', '');
begin
  if owner_id is null then
    raise exception 'Set ciiya.test_owner_id to the approved canary owner';
  end if;
  select * into strict before_usage from public.user_storage_usage
    where user_id = owner_id;
  if before_usage.current_plan <> 'free' then
    raise exception 'Canary owner must start on Free';
  end if;
  select id into strict starter_id from public.plans where slug = 'starter';
  select * into result from public.reconcile_stripe_subscription_entitlement(
    owner_id, 'live', test_sub, 'cus_ciiya_rollback', starter_id, 'active',
    event_time, event_time + interval '1 month', false,
    event_time, 'rollback:paid', true);
  if result.effective_plan <> 'starter' then
    raise exception 'Paid snapshot did not grant Starter';
  end if;
  if not exists(select 1 from public.subscriptions
    where stripe_subscription_id = test_sub and current_period_start = event_time
      and cancel_at_period_end = false) then
    raise exception 'Subscription snapshot columns were not populated';
  end if;
  select * into result from public.reconcile_stripe_subscription_entitlement(
    owner_id, 'live', test_sub, 'cus_ciiya_rollback', starter_id, 'canceled',
    event_time, event_time + interval '1 month', false,
    event_time + interval '1 second', 'rollback:canceled', false);
  if result.effective_plan <> 'free' then
    raise exception 'Canceled snapshot did not restore Free';
  end if;
  select * into result from public.reconcile_stripe_subscription_entitlement(
    owner_id, 'live', test_sub, 'cus_ciiya_rollback', starter_id, 'active',
    event_time, event_time + interval '1 month', false,
    event_time, 'rollback:stale', true);
  if result.effective_plan <> 'free' then
    raise exception 'Stale paid event restored canceled entitlement';
  end if;
  select * into strict after_usage from public.user_storage_usage
    where user_id = owner_id;
  if after_usage.used_bytes is distinct from before_usage.used_bytes
    or after_usage.storage_used_bytes is distinct from before_usage.storage_used_bytes
    or after_usage.photo_count is distinct from before_usage.photo_count
    or after_usage.photos_count is distinct from before_usage.photos_count
    or after_usage.albums_count is distinct from before_usage.albums_count then
    raise exception 'Usage or counts changed';
  end if;
end;
$test$;
rollback;
