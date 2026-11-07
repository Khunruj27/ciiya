-- Repair legacy subscriptions tables created before the Stripe snapshot fields.
-- The entitlement RPC already uses these fields; CREATE TABLE IF NOT EXISTS
-- in schema.sql does not add them to an existing Production table.
begin;

set local lock_timeout = '5s';

alter table public.subscriptions
  add column if not exists current_period_start timestamptz,
  add column if not exists cancel_at_period_end boolean default false;

-- Preserve legacy timestamps and entitlements. Subsequent authoritative Stripe
-- snapshots populate the billing period and scheduled-cancellation flag.
notify pgrst, 'reload schema';
commit;
