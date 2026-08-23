-- The prior fix (202608010001) added a unique index on
-- stripe_subscription_id, but as a *partial* index
-- (WHERE stripe_subscription_id IS NOT NULL). PostgREST's upsert
-- (`on_conflict=stripe_subscription_id`, used by
-- src/app/api/stripe/webhook/route.ts and
-- src/app/api/stripe/change-plan/route.ts) issues a plain
-- `ON CONFLICT (stripe_subscription_id)` with no WHERE predicate, which
-- Postgres can only resolve against a full (non-partial) unique
-- constraint/index — so every subscription upsert has kept failing with
-- "no unique or exclusion constraint matching the ON CONFLICT
-- specification" even after that migration. Confirmed live: every row in
-- production has current_period_end = null because the upsert never
-- succeeds.
--
-- Replace both partial indexes with one real unique constraint. NULLs
-- remain distinct from each other under a standard unique constraint, so
-- this doesn't change how not-yet-linked-to-Stripe rows behave.

drop index if exists public.subscriptions_stripe_subscription_id_unique;
drop index if exists public.idx_subscriptions_unique_stripe_subscription_id;

alter table public.subscriptions
  add constraint subscriptions_stripe_subscription_id_key
  unique (stripe_subscription_id);

notify pgrst, 'reload schema';
