-- Record Stripe-origin proof only when a claimed Live webhook event is
-- completed successfully. The proof is keyed by a secret/account/endpoint
-- fingerprint so any credential or endpoint change fails closed.

begin;

create table if not exists public.stripe_webhook_origin_verifications (
  config_fingerprint text primary key,
  stripe_account_id text not null,
  webhook_endpoint text not null,
  event_id text not null,
  event_type text not null,
  event_created_at timestamptz not null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_webhook_origin_fingerprint_check
    check (config_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint stripe_webhook_origin_account_check
    check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  constraint stripe_webhook_origin_endpoint_check
    check (
      char_length(webhook_endpoint) between 1 and 2048
      and webhook_endpoint ~ '^https://'
    ),
  constraint stripe_webhook_origin_event_id_check
    check (char_length(event_id) between 1 and 255),
  constraint stripe_webhook_origin_event_type_check
    check (
      event_type in (
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'invoice.paid'
      )
    )
);

create unique index if not exists idx_stripe_webhook_origin_event
on public.stripe_webhook_origin_verifications(event_id);

alter table public.stripe_webhook_origin_verifications enable row level security;

-- Intentionally no client policy. This table controls the production billing
-- rollout gate and is available only to trusted server code.
revoke all on table public.stripe_webhook_origin_verifications
  from public, anon, authenticated;
grant all privileges on table public.stripe_webhook_origin_verifications
  to service_role;

create or replace function public.complete_stripe_webhook_event_with_origin_verification(
  p_event_id text,
  p_attempt_count integer,
  p_config_fingerprint text,
  p_stripe_account_id text,
  p_webhook_endpoint text,
  p_event_type text,
  p_event_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_existing_account_id text;
  v_existing_endpoint text;
  v_row_count bigint;
begin
  if p_event_id is null
    or char_length(p_event_id) not between 1 and 255
    or p_attempt_count is null
    or p_attempt_count <= 0
    or p_config_fingerprint is null
    or p_config_fingerprint !~ '^[a-f0-9]{64}$'
    or p_stripe_account_id is null
    or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
    or p_webhook_endpoint is null
    or char_length(p_webhook_endpoint) not between 1 and 2048
    or p_webhook_endpoint !~ '^https://'
    or p_event_type not in (
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'invoice.paid'
    )
    or p_event_created_at is null
    or p_event_created_at > now() + interval '5 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'INVALID_STRIPE_WEBHOOK_ORIGIN_VERIFICATION';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('stripe-webhook-origin:' || p_config_fingerprint, 0)
  );

  select v.stripe_account_id, v.webhook_endpoint
  into v_existing_account_id, v_existing_endpoint
  from public.stripe_webhook_origin_verifications as v
  where v.config_fingerprint = p_config_fingerprint
  for update;

  if found
    and (
      v_existing_account_id is distinct from p_stripe_account_id
      or v_existing_endpoint is distinct from p_webhook_endpoint
    )
  then
    raise exception using
      errcode = '23514',
      message = 'STRIPE_WEBHOOK_ORIGIN_CONFIG_MISMATCH';
  end if;

  update public.stripe_webhook_events as e
  set
    status = 'completed',
    completed_at = now(),
    failed_at = null,
    last_error = null,
    updated_at = now()
  where e.event_id = p_event_id
    and e.event_type = p_event_type
    and e.livemode is true
    and e.status = 'processing'
    and e.attempt_count = p_attempt_count;

  get diagnostics v_row_count = row_count;

  if v_row_count = 0 then
    return false;
  end if;

  insert into public.stripe_webhook_origin_verifications as v (
    config_fingerprint,
    stripe_account_id,
    webhook_endpoint,
    event_id,
    event_type,
    event_created_at,
    verified_at,
    created_at,
    updated_at
  ) values (
    p_config_fingerprint,
    p_stripe_account_id,
    p_webhook_endpoint,
    p_event_id,
    p_event_type,
    p_event_created_at,
    now(),
    now(),
    now()
  )
  on conflict (config_fingerprint) do update
  set event_id = excluded.event_id,
      event_type = excluded.event_type,
      event_created_at = excluded.event_created_at,
      verified_at = now(),
      updated_at = now()
  where excluded.event_created_at >= v.event_created_at;

  return true;
end;
$function$;

revoke all on function public.complete_stripe_webhook_event_with_origin_verification(
  text,
  integer,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.complete_stripe_webhook_event_with_origin_verification(
  text,
  integer,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;

notify pgrst, 'reload schema';

commit;
