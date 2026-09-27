-- Keep Stripe test data available while preparing a reversible live cutover.
-- Existing plans.stripe_price_id values remain the test-mode mapping.

alter table public.plans
  add column if not exists stripe_live_price_id text;

create unique index if not exists idx_plans_unique_stripe_live_price_id
  on public.plans (stripe_live_price_id)
  where stripe_live_price_id is not null;

comment on column public.plans.stripe_price_id is
  'Stripe test-mode Price ID retained for development and rollback.';

comment on column public.plans.stripe_live_price_id is
  'Stripe live-mode Price ID. Must remain null until the live catalog is verified.';

alter table public.subscriptions
  add column if not exists stripe_mode text not null default 'test';

alter table public.subscriptions
  drop constraint if exists subscriptions_stripe_mode_check;

alter table public.subscriptions
  add constraint subscriptions_stripe_mode_check
  check (stripe_mode in ('test', 'live'));

create index if not exists idx_subscriptions_user_mode_status
  on public.subscriptions (user_id, stripe_mode, status);

comment on column public.subscriptions.stripe_mode is
  'Stripe object namespace for this row. Existing rows are test-mode data.';

notify pgrst, 'reload schema';
