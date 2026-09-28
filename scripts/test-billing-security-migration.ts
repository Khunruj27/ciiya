import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationPath =
  'supabase/migrations/202609280001_billing_security_hardening.sql'
const checkoutLockMigrationPath =
  'supabase/migrations/202609280002_stripe_checkout_lock.sql'
const entitlementMigrationPath =
  'supabase/migrations/202609280003_stripe_entitlement_reconciliation.sql'
const originVerificationMigrationPath =
  'supabase/migrations/202609280004_stripe_webhook_origin_verification.sql'
const schemaPath = 'supabase/schema.sql'

function normalized(source: string) {
  return source.replace(/\s+/g, ' ').trim().toLowerCase()
}

function assertBillingRls(sql: string, label: string) {
  for (const table of ['plans', 'subscriptions', 'user_storage_usage']) {
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        'i'
      ),
      `${label}: ${table} must have RLS enabled`
    )
  }

  assert.match(
    sql,
    /create policy "plans_select_active" on public\.plans for select to authenticated using \(is_active is true\)/i,
    `${label}: authenticated users may only select active plans`
  )
  assert.match(
    sql,
    /create policy "subscriptions_select_own" on public\.subscriptions for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/i,
    `${label}: subscriptions must be owner-readable only`
  )
  assert.match(
    sql,
    /create policy "user_storage_usage_select_own" on public\.user_storage_usage for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/i,
    `${label}: quota state must be owner-readable only`
  )

  for (const table of ['plans', 'subscriptions', 'user_storage_usage']) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on table public\\.${table} from public, anon, authenticated`,
        'i'
      ),
      `${label}: ${table} must remove inherited client mutations`
    )
    assert.match(
      sql,
      new RegExp(
        `grant select on table public\\.${table} to authenticated`,
        'i'
      ),
      `${label}: ${table} must restore read-only authenticated access`
    )
    assert.match(
      sql,
      new RegExp(
        `grant all privileges on table public\\.${table} to service_role`,
        'i'
      ),
      `${label}: ${table} must remain writable by the service role`
    )
  }
}

function assertPrivateWebhookLedger(sql: string, label: string) {
  assert.match(
    sql,
    /create table if not exists public\.stripe_webhook_events/i,
    `${label}: webhook ledger is required`
  )
  assert.match(
    sql,
    /status in \('processing', 'completed', 'failed'\)/i,
    `${label}: webhook lifecycle states are incomplete`
  )
  assert.match(
    sql,
    /alter table public\.stripe_webhook_events enable row level security/i,
    `${label}: webhook ledger must have RLS enabled`
  )
  assert.match(
    sql,
    /revoke all on table public\.stripe_webhook_events from public, anon, authenticated/i,
    `${label}: webhook ledger must be private`
  )
  assert.match(
    sql,
    /grant all privileges on table public\.stripe_webhook_events to service_role/i,
    `${label}: webhook ledger must remain available to the server`
  )
  assert.doesNotMatch(
    sql,
    /create policy [^;]+ on public\.stripe_webhook_events/i,
    `${label}: webhook ledger must not expose a client RLS policy`
  )

  assert.match(
    sql,
    /create or replace function public\.claim_stripe_webhook_event/i,
    `${label}: atomic webhook claim function is required`
  )
  assert.match(
    sql,
    /on conflict \(event_id\) do nothing/i,
    `${label}: initial event claim must be race-safe`
  )
  assert.match(
    sql,
    /attempt_count = e\.attempt_count \+ 1/i,
    `${label}: retries must increment attempt_count`
  )
  assert.match(
    sql,
    /e\.status = 'failed'.+e\.status = 'processing'.+e\.processing_started_at <= now\(\) - p_stale_after/i,
    `${label}: failed and stale processing events must be reclaimable`
  )
  assert.match(
    sql,
    /message = 'stripe_webhook_event_mismatch'/i,
    `${label}: an event ID cannot change type or livemode`
  )
  assert.match(
    sql,
    /complete_stripe_webhook_event\( p_event_id text, p_attempt_count integer \).+e\.attempt_count = p_attempt_count/i,
    `${label}: completion must fence stale webhook attempts`
  )
  assert.match(
    sql,
    /fail_stripe_webhook_event\( p_event_id text, p_attempt_count integer, p_error text \).+e\.attempt_count = p_attempt_count/i,
    `${label}: failure updates must fence stale webhook attempts`
  )

  for (const fn of [
    'claim_stripe_webhook_event',
    'complete_stripe_webhook_event',
    'fail_stripe_webhook_event',
  ]) {
    assert.match(
      sql,
      new RegExp(`create or replace function public\\.${fn}`, 'i'),
      `${label}: ${fn} is required`
    )
  }

  assert.match(
    sql,
    /grant execute on function public\.claim_stripe_webhook_event\( text, text, boolean, interval \) to service_role/i,
    `${label}: webhook claim must be service-role only`
  )
  assert.match(
    sql,
    /revoke all on function public\.claim_stripe_webhook_event\( text, text, boolean, interval \) from public, anon, authenticated/i,
    `${label}: clients must not claim webhook events`
  )
}

function assertQuotaFunctionsAreDefiners(sql: string, label: string) {
  for (const fn of [
    'update_storage_after_photo_insert',
    'update_storage_after_photo_delete',
    'update_storage_after_asset_change',
    'recalculate_user_storage',
  ]) {
    assert.match(
      sql,
      new RegExp(
        `function public\\.${fn}\\([^)]*\\)[\\s\\S]{0,180}security definer`,
        'i'
      ),
      `${label}: ${fn} must execute with a fixed security-definer context`
    )
  }
}

function functionDefinition(sql: string, name: string) {
  const startMarker = `create or replace function public.${name}(`
  const start = sql.indexOf(startMarker)
  assert.notEqual(start, -1, `${name} definition is missing`)

  const end = sql.indexOf('$function$;', start)
  assert.notEqual(end, -1, `${name} definition is incomplete`)

  return sql.slice(start, end + '$function$;'.length)
}

function assertCheckoutLock(sql: string, label: string) {
  assert.match(
    sql,
    /create table if not exists public\.stripe_checkout_attempts/i,
    `${label}: checkout attempt table is required`
  )
  assert.match(
    sql,
    /primary key \(user_id, stripe_mode\)/i,
    `${label}: checkout claims must serialize each user and Stripe mode`
  )
  assert.match(
    sql,
    /status in \('processing', 'open', 'completed', 'failed'\)/i,
    `${label}: checkout attempt states are incomplete`
  )
  assert.match(
    sql,
    /expires_at timestamptz not null/i,
    `${label}: every checkout attempt needs a bounded persisted expiry`
  )
  assert.match(
    sql,
    /create unique index if not exists idx_stripe_checkout_attempt_session on public\.stripe_checkout_attempts\(stripe_checkout_session_id\) where stripe_checkout_session_id is not null/i,
    `${label}: a Stripe Checkout Session must map to one lock row`
  )
  assert.match(
    sql,
    /alter table public\.stripe_checkout_attempts enable row level security/i,
    `${label}: checkout attempts must have RLS enabled`
  )
  assert.match(
    sql,
    /revoke all on table public\.stripe_checkout_attempts from public, anon, authenticated/i,
    `${label}: browser clients must not access checkout attempts`
  )
  assert.match(
    sql,
    /grant all privileges on table public\.stripe_checkout_attempts to service_role/i,
    `${label}: checkout attempts must remain server-writable`
  )
  assert.doesNotMatch(
    sql,
    /create policy [^;]+ on public\.stripe_checkout_attempts/i,
    `${label}: checkout attempts must not expose a client policy`
  )

  const claim = functionDefinition(sql, 'claim_stripe_checkout_attempt')
  assert.match(claim, /security definer set search_path = public, pg_temp/i)
  assert.match(claim, /on conflict \(user_id, stripe_mode\) do nothing/i)
  assert.match(
    claim,
    /p_expires_at <= now\(\) \+ interval '30 minutes'.+p_expires_at > now\(\) \+ interval '24 hours'/i,
    `${label}: a claimed attempt must persist a valid Stripe expiry`
  )
  assert.match(
    claim,
    /insert into public\.stripe_checkout_attempts.+expires_at.+p_expires_at.+returning a\.attempt_token, a\.expires_at/i,
    `${label}: initial claims must persist and return their exact expiry`
  )
  assert.match(
    claim,
    /attempt_token = gen_random_uuid\(\).+a\.status = 'failed'/i,
    `${label}: failed attempts must start a new token`
  )
  assert.doesNotMatch(
    claim,
    /a\.status = 'open'\s+and a\.expires_at <= now\(\)/i,
    `${label}: an expired-open row must be reconciled with Stripe before replacement`
  )

  assert.match(
    claim,
    /attempt_token = gen_random_uuid\(\).+expires_at = p_expires_at.+a\.status = 'processing'.+a\.expires_at <= now\(\)/i,
    `${label}: expired processing attempts must recover with a fresh bounded token`
  )

  assert.match(
    claim,
    /returning a\.attempt_token, a\.expires_at into v_token, v_expires_at/i,
    `${label}: claims must return the immutable request expiry`
  )

  const staleStart = claim.indexOf(
    'update public.stripe_checkout_attempts as a set processing_started_at = now()'
  )
  assert.notEqual(staleStart, -1, `${label}: stale retry branch is missing`)
  const staleEnd = claim.indexOf(
    'returning a.attempt_token, a.expires_at into v_token, v_expires_at;',
    staleStart
  )
  assert.notEqual(staleEnd, -1, `${label}: stale retry return is missing`)
  const staleRetry = claim.slice(
    staleStart,
    staleEnd +
      'returning a.attempt_token, a.expires_at into v_token, v_expires_at;'
        .length
  )
  assert.match(staleRetry, /a\.plan_id = p_plan_id/i)
  assert.match(staleRetry, /a\.status = 'processing'/i)
  assert.match(staleRetry, /a\.expires_at > now\(\)/i)
  assert.match(
    staleRetry,
    /a\.processing_started_at <= now\(\) - p_stale_after/i
  )
  assert.doesNotMatch(
    staleRetry,
    /attempt_token\s*=/i,
    `${label}: stale same-plan retry must reuse its Stripe idempotency token`
  )
  assert.match(
    staleRetry,
    /returning a\.attempt_token, a\.expires_at into v_token, v_expires_at/i,
    `${label}: stale same-plan retry must reuse its exact Stripe expiry`
  )

  const open = functionDefinition(sql, 'open_stripe_checkout_attempt')
  assert.match(open, /set status = 'open'/i)
  assert.match(open, /a\.user_id = p_user_id/i)
  assert.match(open, /a\.stripe_mode = p_stripe_mode/i)
  assert.match(open, /a\.attempt_token = p_attempt_token/i)
  assert.match(open, /a\.status = 'processing'/i)

  const fail = functionDefinition(sql, 'fail_stripe_checkout_attempt')
  assert.match(fail, /set status = 'failed'/i)
  assert.match(fail, /a\.attempt_token = p_attempt_token/i)
  assert.match(fail, /a\.status = 'processing'/i)

  const complete = functionDefinition(sql, 'complete_stripe_checkout_attempt')
  assert.match(complete, /set status = 'completed'/i)
  assert.match(complete, /a\.user_id = p_user_id/i)
  assert.match(complete, /a\.stripe_mode = p_stripe_mode/i)
  assert.match(complete, /a\.stripe_checkout_session_id = p_session_id/i)
  assert.match(
    complete,
    /a\.status in \('processing', 'open', 'completed'\)/i,
    `${label}: repeated completion must remain idempotent`
  )

  const expire = functionDefinition(sql, 'expire_stripe_checkout_attempt')
  assert.match(expire, /set status = 'failed'/i)
  assert.match(expire, /a\.user_id = p_user_id/i)
  assert.match(expire, /a\.stripe_mode = p_stripe_mode/i)
  assert.match(expire, /a\.stripe_checkout_session_id = p_session_id/i)
  assert.match(
    expire,
    /a\.status in \('open', 'failed'\)/i,
    `${label}: repeated expiry must remain idempotent`
  )
  assert.doesNotMatch(
    expire,
    /completed/i,
    `${label}: delayed expiry must never demote a completed attempt`
  )

  const retire = functionDefinition(
    sql,
    'retire_terminal_stripe_checkout_attempt'
  )
  assert.match(retire, /security definer set search_path = public, pg_temp/i)
  assert.match(
    retire,
    /p_stripe_mode is null or p_stripe_mode not in \('test', 'live'\)/i,
    `${label}: terminal retirement must reject a null or unknown Stripe mode`
  )
  assert.match(retire, /a\.user_id = p_user_id/i)
  assert.match(retire, /a\.stripe_mode = p_stripe_mode/i)
  assert.match(retire, /a\.stripe_checkout_session_id = p_session_id/i)
  assert.match(retire, /a\.status in \('open', 'completed'\)/i)

  const functionSignatures = [
    'claim_stripe_checkout_attempt\\( uuid, text, uuid, timestamptz, interval \\)',
    'open_stripe_checkout_attempt\\( uuid, text, uuid, text, timestamptz \\)',
    'fail_stripe_checkout_attempt\\(uuid, text, uuid\\)',
    'complete_stripe_checkout_attempt\\(uuid, text, text\\)',
    'expire_stripe_checkout_attempt\\(uuid, text, text\\)',
    'retire_terminal_stripe_checkout_attempt\\( uuid, text, text \\)',
  ]

  for (const signature of functionSignatures) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${signature} from public, anon, authenticated`,
        'i'
      ),
      `${label}: ${signature} must reject client RPC access`
    )
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${signature} to service_role`,
        'i'
      ),
      `${label}: ${signature} must be callable by the server`
    )
  }

  assert.doesNotMatch(
    sql,
    /release_completed_stripe_checkout_attempt/i,
    `${label}: no user/mode-wide release may delete a newer completed Checkout lock`
  )
}

function assertWebhookOriginVerification(sql: string, label: string) {
  assert.match(
    sql,
    /create table if not exists public\.stripe_webhook_origin_verifications/i,
    `${label}: origin-verification table is required`
  )
  assert.match(
    sql,
    /config_fingerprint text primary key/i,
    `${label}: the current secret/account/endpoint fingerprint must be unique`
  )
  assert.match(
    sql,
    /alter table public\.stripe_webhook_origin_verifications enable row level security/i,
    `${label}: origin proof must have RLS enabled`
  )
  assert.match(
    sql,
    /revoke all on table public\.stripe_webhook_origin_verifications from public, anon, authenticated/i,
    `${label}: browser clients must not read or forge origin proof`
  )
  assert.match(
    sql,
    /grant all privileges on table public\.stripe_webhook_origin_verifications to service_role/i,
    `${label}: trusted server code must retain origin-proof access`
  )
  assert.doesNotMatch(
    sql,
    /create policy [^;]+ on public\.stripe_webhook_origin_verifications/i,
    `${label}: origin proof must not expose a client policy`
  )

  const complete = functionDefinition(
    sql,
    'complete_stripe_webhook_event_with_origin_verification'
  )
  assert.match(complete, /security definer set search_path = public, pg_temp/i)
  assert.match(complete, /e\.event_id = p_event_id/i)
  assert.match(complete, /e\.event_type = p_event_type/i)
  assert.match(complete, /e\.livemode is true/i)
  assert.match(complete, /e\.status = 'processing'/i)
  assert.match(complete, /e\.attempt_count = p_attempt_count/i)
  assert.match(
    complete,
    /insert into public\.stripe_webhook_origin_verifications/i,
    `${label}: ledger completion and proof insert must share one transaction`
  )

  const signature =
    'complete_stripe_webhook_event_with_origin_verification\\( text, integer, text, text, text, text, timestamptz \\)'
  assert.match(
    sql,
    new RegExp(
      `revoke all on function public\\.${signature} from public, anon, authenticated`,
      'i'
    )
  )
  assert.match(
    sql,
    new RegExp(`grant execute on function public\\.${signature} to service_role`, 'i')
  )
}

function assertAtomicEntitlementReconciliation(sql: string, label: string) {
  for (const column of [
    'stripe_state_event_created_at',
    'stripe_state_event_id',
    'entitlement_plan_id',
    'entitlement_event_created_at',
    'entitlement_event_id',
  ]) {
    assert.match(
      sql,
      new RegExp(`add column if not exists ${column}`, 'i'),
      `${label}: subscriptions.${column} is required`
    )
  }

  assert.match(
    sql,
    /idx_subscriptions_effective_entitlement.+where entitlement_plan_id is not null and status in \('active', 'trialing', 'past_due'\)/i,
    `${label}: effective-entitlement lookup must be indexed`
  )

  const reconcile = functionDefinition(
    sql,
    'reconcile_stripe_subscription_entitlement'
  )

  assert.match(
    reconcile,
    /security definer set search_path = public, pg_temp/i,
    `${label}: reconciliation must use a fixed security-definer context`
  )
  assert.match(
    reconcile,
    /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/i,
    `${label}: reconciliation must serialize the shared quota row across Test and Live`
  )
  assert.doesNotMatch(
    reconcile,
    /hashtextextended\(p_user_id::text \|\| ':' \|\| p_stripe_mode/i,
    `${label}: Test and Live may not use separate locks for one shared quota row`
  )
  assert.match(
    reconcile,
    /p_stripe_mode is null or p_stripe_mode not in \('test', 'live'\)/i,
    `${label}: reconciliation must reject a null or unknown Stripe mode`
  )
  assert.match(
    reconcile,
    /p_status is null or p_status not in \( 'active', 'trialing', 'past_due', 'paused', 'unpaid', 'incomplete', 'incomplete_expired', 'canceled' \)/i,
    `${label}: every Stripe subscription status needs an explicit policy`
  )
  assert.match(
    reconcile,
    /p_status in \('canceled', 'incomplete_expired'\) and v_existing\.status not in \('canceled', 'incomplete_expired'\)/i,
    `${label}: a terminal snapshot must defeat a stale active snapshot`
  )
  assert.match(
    reconcile,
    /v_existing\.status in \('canceled', 'incomplete_expired'\) and p_status not in \('canceled', 'incomplete_expired'\)/i,
    `${label}: terminal subscriptions must not be revived`
  )
  assert.match(
    reconcile,
    /v_current\.status in \( 'paused', 'unpaid', 'incomplete', 'incomplete_expired', 'canceled' \).+set entitlement_plan_id = null/i,
    `${label}: paused/unpaid/incomplete/terminal states must revoke entitlement`
  )
  assert.match(
    reconcile,
    /p_grant_entitlement and v_current\.status in \('active', 'trialing'\).+set entitlement_plan_id = p_plan_id/i,
    `${label}: only paid active/trialing snapshots may newly grant entitlement`
  )
  assert.match(
    reconcile,
    /v_state_applied and v_current\.status = 'past_due'.+set entitlement_event_created_at = p_event_created_at/i,
    `${label}: past_due must retain, but never newly create, entitlement`
  )

  const lockAt = reconcile.indexOf('pg_advisory_xact_lock')
  const subscriptionWriteAt = reconcile.indexOf(
    'insert into public.subscriptions'
  )
  const quotaWriteAt = reconcile.indexOf(
    'insert into public.user_storage_usage'
  )
  assert.ok(
    lockAt >= 0 && lockAt < subscriptionWriteAt && subscriptionWriteAt < quotaWriteAt,
    `${label}: one lock must cover subscription state and quota derivation`
  )

  assert.match(
    reconcile,
    /where live_subscription\.user_id = p_user_id and live_subscription\.stripe_mode = 'live'.+then 'live' else 'test' end into v_effective_mode/i,
    `${label}: any Live subscription history must make Live authoritative for shared quota`
  )
  assert.match(
    reconcile,
    /select count\(\*\)::integer into v_eligible_count from public\.subscriptions as s where s\.user_id = p_user_id and s\.stripe_mode = v_effective_mode and s\.status in \('active', 'trialing', 'past_due'\) and s\.entitlement_plan_id is not null/i,
    `${label}: duplicate eligible subscriptions must be reported`
  )
  assert.match(
    reconcile,
    /from public\.subscriptions as s join public\.plans as p on p\.id = s\.entitlement_plan_id where s\.user_id = p_user_id and s\.stripe_mode = v_effective_mode and s\.status in \('active', 'trialing', 'past_due'\).+order by s\.entitlement_event_created_at desc nulls last/i,
    `${label}: quota must be re-derived from all authoritative eligible rows`
  )
  assert.doesNotMatch(
    reconcile,
    /v_eligible_count\s*>\s*1.+raise exception/i,
    `${label}: duplicate reporting must not roll back durable reconciliation`
  )

  // These predicates are the two delivery-order cases: cancel-old then
  // pay-new, or pay-new then cancel-old. Both serialize, mutate only their own
  // row, and derive quota from the full eligible set before committing.
  assert.match(reconcile, /where s\.id = v_current\.id/i)
  assert.match(
    reconcile,
    /where s\.user_id = p_user_id and s\.stripe_mode = v_effective_mode and s\.status in \('active', 'trialing', 'past_due'\)/i,
    `${label}: replacement ordering must not let old cancellation erase new paid quota`
  )

  const signature =
    'reconcile_stripe_subscription_entitlement\\( uuid, text, text, text, uuid, text, timestamptz, timestamptz, boolean, timestamptz, text, boolean \\)'
  assert.match(
    sql,
    new RegExp(
      `revoke all on function public\\.${signature} from public, anon, authenticated`,
      'i'
    ),
    `${label}: browser clients must not invoke reconciliation`
  )
  assert.match(
    sql,
    new RegExp(
      `grant execute on function public\\.${signature} to service_role`,
      'i'
    ),
    `${label}: reconciliation must remain callable by the server`
  )
}

async function main() {
  const [
    migrationSource,
    checkoutLockSource,
    entitlementSource,
    originVerificationSource,
    schemaSource,
  ] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(checkoutLockMigrationPath, 'utf8'),
    readFile(entitlementMigrationPath, 'utf8'),
    readFile(originVerificationMigrationPath, 'utf8'),
    readFile(schemaPath, 'utf8'),
  ])
  const migration = normalized(migrationSource)
  const checkoutLockMigration = normalized(checkoutLockSource)
  const entitlementMigration = normalized(entitlementSource)
  const originVerificationMigration = normalized(originVerificationSource)
  const schema = normalized(schemaSource)

  assertBillingRls(migration, 'migration')
  assertBillingRls(schema, 'schema')
  assertPrivateWebhookLedger(migration, 'migration')
  assertPrivateWebhookLedger(schema, 'schema')
  assertQuotaFunctionsAreDefiners(migration, 'migration')
  assertQuotaFunctionsAreDefiners(schema, 'schema')
  assertCheckoutLock(checkoutLockMigration, 'checkout lock migration')
  assertCheckoutLock(schema, 'schema')
  assertAtomicEntitlementReconciliation(
    entitlementMigration,
    'entitlement migration'
  )
  assertAtomicEntitlementReconciliation(schema, 'schema')
  assertWebhookOriginVerification(
    originVerificationMigration,
    'origin verification migration'
  )
  assertWebhookOriginVerification(schema, 'schema')

  assert.match(migration, /^--.+ begin;/i, 'migration must be transactional')
  assert.match(migration, /notify pgrst, 'reload schema'; commit;$/i)
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i)
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i)
  assert.match(
    checkoutLockMigration,
    /^--.+ begin;/i,
    'checkout lock migration must be transactional'
  )
  assert.match(
    checkoutLockMigration,
    /notify pgrst, 'reload schema'; commit;$/i
  )
  assert.equal(
    checkoutLockMigration.match(
      /\bdelete\s+from\s+public\.stripe_checkout_attempts\b/gi
    )?.length,
    1,
    'checkout lock migration may delete only through its exact-session retire RPC'
  )
  assert.doesNotMatch(checkoutLockMigration, /\bdrop\s+table\b/i)
  assert.match(
    entitlementMigration,
    /^--.+ begin;/i,
    'entitlement migration must be transactional'
  )
  assert.match(
    entitlementMigration,
    /notify pgrst, 'reload schema'; commit;$/i
  )
  assert.doesNotMatch(entitlementMigration, /\bdelete\s+from\b/i)
  assert.doesNotMatch(entitlementMigration, /\bdrop\s+table\b/i)
  assert.match(
    originVerificationMigration,
    /^--.+ begin;/i,
    'origin verification migration must be transactional'
  )
  assert.match(
    originVerificationMigration,
    /notify pgrst, 'reload schema'; commit;$/i
  )
  assert.doesNotMatch(originVerificationMigration, /\bdelete\s+from\b/i)
  assert.doesNotMatch(originVerificationMigration, /\bdrop\s+table\b/i)

  console.log('Billing security migration contract checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
