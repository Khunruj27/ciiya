-- Fix broken Stripe subscription sync.
--
-- src/app/api/stripe/webhook/route.ts and src/app/api/stripe/change-plan/route.ts
-- both upsert into public.subscriptions with { onConflict: 'stripe_subscription_id' },
-- but no unique constraint on that column ever existed (only a plain index on
-- user_id). PostgREST rejects an upsert whose on_conflict target has no matching
-- unique/exclusion constraint, so every real-subscription sync after a Stripe
-- checkout or plan change has been silently failing and the user's plan/storage
-- limit never updated after payment.

-- Defensive de-dup first, in case any duplicate stripe_subscription_id rows
-- slipped in through other code paths before this constraint existed.
with ranked as (
  select
    id,
    row_number() over (
      partition by stripe_subscription_id
      order by updated_at desc nulls last, created_at desc
    ) as rn
  from public.subscriptions
  where stripe_subscription_id is not null
)
delete from public.subscriptions s
using ranked
where s.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists idx_subscriptions_unique_stripe_subscription_id
on public.subscriptions(stripe_subscription_id)
where stripe_subscription_id is not null;

notify pgrst, 'reload schema';
