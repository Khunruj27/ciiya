# Stripe Live readiness for Ciiya

Status: prepared, **not activated**. Ciiya must remain in Stripe Test mode until
every required preflight check passes and a cutover window is approved.

## Safety model

- `STRIPE_MODE=test` is the default.
- Live API access is rejected unless `STRIPE_MODE=live` and
  `STRIPE_LIVE_ENABLED=true` are both present.
- Secret/restricted and publishable keys must match the configured mode.
- Existing `plans.stripe_price_id` values stay assigned to Test mode.
- Live prices use `plans.stripe_live_price_id`.
- Existing subscriptions are backfilled with `stripe_mode=test`; live and test
  Customer/Subscription IDs are never reused across modes.
- Live credentials are staged under `STRIPE_LIVE_*` names and selected only
  after both Live gates are enabled. Test credentials remain available for a
  controlled pre-customer rollback.
- Plan changes and cancellations use the Stripe Customer Portal. Retired
  direct-change routes return `410` and never mutate quota.
- Storage entitlement changes only after a paid Checkout or Invoice webhook,
  and webhook deliveries are claimed in a private idempotency ledger.
- Checkout idempotency is derived from trusted server state, so repeated clicks,
  tabs, and network retries cannot create parallel Checkout Sessions.
- `STRIPE_CHECKOUT_ENABLED=false` closes only new Checkout. Existing live
  webhooks and Customer Portal access remain available during an incident.
- Live Checkout also has `off`, UUID-bounded `canary`, and `all` rollout modes.
  The first real charge must use one dedicated canary owner; never open Live
  Checkout to every account as the first production test.
- A locally signed `ciiya.webhook_canary` proves only Ciiya's configured
  signature, route, and ledger path. Global rollout additionally requires a
  Live billing event retrieved back from Stripe and recorded against the
  current endpoint/secret/account fingerprint.
- Paid entitlement is granted only for `active`/`trialing` after paid evidence.
  `past_due` retains the last paid entitlement during a bounded Stripe recovery
  window; `paused`, `unpaid`, `incomplete`, `incomplete_expired`, and `canceled`
  do not grant a new paid entitlement.
- Storage quota is one shared row per user. Reconciliation is serialized across
  Test and Live, and Live becomes authoritative as soon as that user has any
  Live subscription history; later Test webhooks cannot restore Test quota.
- `npm run stripe:preflight:live` performs reads only. It never creates or
  updates Stripe or Supabase data.

## 1. Close Checkout, prepare the database, then deploy compatible code

Keep Test mode active and set `STRIPE_CHECKOUT_ENABLED=false` before the
maintenance window. The currently deployed handler uses service-role writes,
so the following additive/security migrations are backward-compatible with it.
Apply them in order before deploying the new handler, because the new handler
requires their RPCs on every subscription reconciliation:

- `supabase/migrations/202609270001_stripe_live_readiness.sql`
- `supabase/migrations/202609280001_billing_security_hardening.sql`
- `supabase/migrations/202609280002_stripe_checkout_lock.sql`
- `supabase/migrations/202609280003_stripe_entitlement_reconciliation.sql`
- `supabase/migrations/202609280004_stripe_webhook_origin_verification.sql`

The second migration locks billing/quota writes behind the service role and
adds the Stripe webhook retry ledger. The third adds an atomic per-user/mode
Checkout reservation so two tabs or two different plans cannot create parallel
subscriptions. The fourth makes subscription and storage entitlement updates
one transaction. The fifth records service-only Stripe-origin verification for
the current endpoint/secret/account fingerprint. Do not roll back to application
code from before this release after applying these migrations. Deploy the new
code immediately after the migrations and keep the runtime values:

```text
STRIPE_MODE=test
STRIPE_LIVE_ENABLED=false
STRIPE_CHECKOUT_ENABLED=false
STRIPE_LIVE_CHECKOUT_ROLLOUT_MODE=off
```

Verify Test checkout, webhook, Customer Portal, and cancellation after the
migration. Existing test subscriptions must continue to work, and every
processed event must appear as `completed` in `stripe_webhook_events`.

`npm run billing:cron` is now an audit-only legacy check. It never changes
quota. Any remaining `pending_plan` row must be reconciled against Stripe and
cleared manually before Live cutover.

## 2. Prepare the live Stripe catalog

In Stripe Live mode:

1. Complete account verification and enable live charges.
2. Create a separate Product for Starter, Pro, and Business.
3. Create one active recurring monthly THB Price per Product:
   - Starter: 299 THB / month
   - Pro: 499 THB / month
   - Business: 699 THB / month
4. Store each live `price_...` ID in the matching
   `plans.stripe_live_price_id`. Do not replace `stripe_price_id`.
5. Configure the live Customer Portal for payment-method updates, plan
   management, and cancellations. Add exactly the three paid Products/Prices,
   keep quantity fixed at one, use immediate price changes, and set proration
   behavior to `always_invoice`. Do not schedule price changes at period end.
   Configure cancellation timing deliberately and test it. Ciiya currently uses
   one Product per plan; do not select an end-of-period downgrade behavior that
   Stripe supports only between Prices of the same Product. Keep only the three
   verified Ciiya Prices; or consolidate the
   catalog into one Product in a separately reviewed migration.

If a customer immediately downgrades below their current storage usage, Ciiya
keeps every existing object but blocks additional uploads until usage is below
the new quota. No billing flow deletes customer files.

Do not enable Stripe Tax only because Live mode is being prepared. Tax must be
enabled only after the required Thai and customer-jurisdiction registrations
have been reviewed; automatic tax does not collect anything without an active
registration.

## 3. Create the live webhook

Create one enabled live endpoint:

```text
https://ciiya.vercel.app/api/stripe/webhook
```

Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Keep its `whsec_...` signing secret in a secrets vault. The test and live
endpoint signing secrets are different.

## 4. Use least-privilege keys

Prefer a dedicated restricted live key (`rk_live_...`) for Ciiya instead of a
full secret key. First validate required permissions with a test restricted key.
The runtime needs the permissions exercised by Checkout, Customers,
Subscriptions, Prices, and Billing Portal sessions. It also needs Account read
access because the webhook verifies the Stripe account before accepting a Live
origin proof, plus Events read access so a processed Live canary event can be
retrieved from Stripe before global rollout. The separate preflight key needs
read access to Account, Products, Prices, Webhook Endpoints, and Billing Portal
configurations.

On Vercel, mark every live secret as a sensitive environment variable. Never
put `rk_live_...`, `sk_live_...`, or `whsec_...` in Git, browser code, screenshots,
logs, or support messages. Require passkeys or an authenticator app for Stripe
Dashboard access.

## 5. Run the read-only preflight

Set these only in a secure local/CI environment used for the audit:

```text
STRIPE_PREFLIGHT_SECRET_KEY=rk_live_...
STRIPE_PREFLIGHT_PUBLISHABLE_KEY=pk_live_...
STRIPE_PREFLIGHT_WEBHOOK_SECRET=whsec_...
STRIPE_PREFLIGHT_WEBHOOK_URL=https://ciiya.vercel.app/api/stripe/webhook
STRIPE_LIVE_RUNTIME_SECRET_KEY=rk_live_...
STRIPE_EXPECTED_LIVE_ACCOUNT_ID=acct_...
STRIPE_EXPECTED_PRODUCTION_SUPABASE_REF=your-production-project-ref
NEXT_PUBLIC_SITE_URL=https://ciiya.vercel.app
```

The same environment must point to the production Supabase project so the
command can read the live plan mappings:

```bash
npm run stripe:preflight:live
```

Before the Live deployment, every check except the two expected delivery proofs
must pass: the internal Live webhook smoke and Stripe-origin verification cannot
exist while Production still rejects Live events. Review every other `WARN` and
`FAIL`, especially active test subscriptions and any paid storage entitlement
without an exactly matching Live subscription/plan/quota. The command pins the
Stripe account and Supabase project and proves that the staged runtime key can
retrieve the exact audited catalog. It prints no secret values and performs no
writes.

Configure Stripe's failed-payment recovery with a finite retry window and a
terminal transition to `unpaid` or `canceled`. Do not leave subscriptions in
`past_due` indefinitely, because Ciiya deliberately preserves the last paid
storage entitlement during that recovery state.

## 6. Approved cutover

Do this only inside an announced maintenance window:

1. Export/back up `plans`, `subscriptions`, and `user_storage_usage`.
2. Resolve test users whose paid storage entitlement must not carry into Live.
3. Set the Vercel Production values together:
   - `STRIPE_MODE=live`
   - `STRIPE_LIVE_ENABLED=true`
   - `STRIPE_LIVE_RUNTIME_SECRET_KEY=rk_live_...`
   - `STRIPE_LIVE_PUBLISHABLE_KEY=pk_live_...`
   - `STRIPE_LIVE_WEBHOOK_SECRET=whsec_...` for the live endpoint
   - `STRIPE_CHECKOUT_ENABLED=false` during the initial Live deployment
   - `STRIPE_LIVE_CHECKOUT_ROLLOUT_MODE=off`
   - `STRIPE_LIVE_CHECKOUT_CANARY_OWNER_IDS=<full Supabase user UUID>`
   - `STRIPE_EXPECTED_LIVE_ACCOUNT_ID=acct_...`
   - Keep Test values in `STRIPE_SECRET_KEY`,
     `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET`
4. Redeploy Ciiya. Railway photo/face workers do not need Stripe keys.
5. With Checkout still closed, run the configuration-bound internal smoke:
   `STRIPE_WEBHOOK_CANARY_APPLY_ENABLED=true npm run stripe:webhook:canary`.
   Rerun preflight and confirm the internal webhook check passes. This is not a
   substitute for a Stripe-origin event.
6. Set `STRIPE_CHECKOUT_ENABLED=true` and
   `STRIPE_LIVE_CHECKOUT_ROLLOUT_MODE=canary`, redeploy, and verify only the
   allowlisted owner can start Checkout.
7. Run one low-value real subscription with that dedicated canary account.
8. Confirm Checkout, the exact Stripe event ID in Workbench and Ciiya's ledger,
   `subscriptions.stripe_mode=live`, the exact plan/quota, invoice receipt,
   Customer Portal, payment recovery, cancellation, and refund operations.
   When a refund must revoke access immediately, the policy is **cancel the
   subscription immediately, wait for and verify the subscription webhook plus
   entitlement reconciliation, then refund**. A cancellation scheduled for the
   period end intentionally preserves access until that period ends; refunding
   by itself never changes entitlement.
9. Rerun preflight. Require zero `FAIL` entries, including Stripe-origin
   verification, before setting `STRIPE_LIVE_CHECKOUT_ROLLOUT_MODE=all`.
10. Check Vercel logs and Stripe Workbench without logging credentials or full
   payment/customer data.

After the ledger has accumulated production history, schedule
`npm run stripe:webhook:cleanup`. It is dry-run by default. Retain at least 30
days (90 is the default), and set
`STRIPE_WEBHOOK_LEDGER_CLEANUP_APPLY_ENABLED=true` only in the dedicated
maintenance job. Failed and in-flight events are never deleted by this task.

## 7. Rollback

The database keeps both price mappings and separates subscription records, but
storage entitlement is intentionally one shared row per user:

Before any Live subscription exists, the deployment can return to Test mode.
After a Live subscription or payment exists, `user_storage_usage` is shared
entitlement state, so switching Production back to Test mode is not a safe
runtime rollback. Instead:

1. Keep `STRIPE_MODE=live` so existing Live webhooks continue reconciling.
2. Set `STRIPE_CHECKOUT_ENABLED=false` and redeploy to stop new subscriptions.
3. Disable plan switching in the Live Customer Portal if the incident involves
   subscription changes; keep payment recovery/cancellation available when safe.
4. Reconcile the canary/customer subscription and quota, fix forward, and only
   then reopen Checkout.
5. Disable the live webhook only after every live subscription is safely
   canceled/refunded and no live delivery remains pending.

Never delete or overwrite Test or Live Stripe objects as part of rollback.
