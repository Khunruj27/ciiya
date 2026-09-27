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
- `npm run stripe:preflight:live` performs reads only. It never creates or
  updates Stripe or Supabase data.

## 1. Prepare the database while Test mode is still active

Apply `supabase/migrations/202609270001_stripe_live_readiness.sql`, then keep the
runtime values unchanged:

```text
STRIPE_MODE=test
STRIPE_LIVE_ENABLED=false
```

Verify Test checkout, webhook, plan change, and Customer Portal after the
migration. Existing test subscriptions must continue to work.

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
5. Configure the live Customer Portal for plan management and cancellations.

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
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Keep its `whsec_...` signing secret in a secrets vault. The test and live
endpoint signing secrets are different.

## 4. Use least-privilege keys

Prefer a dedicated restricted live key (`rk_live_...`) for Ciiya instead of a
full secret key. First validate required permissions with a test restricted key.
The runtime needs the permissions exercised by Checkout, Customers,
Subscriptions, Prices, and Billing Portal sessions. The separate preflight key
also needs read access to Account and Webhook Endpoints.

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
```

The same environment must point to the production Supabase project so the
command can read the live plan mappings:

```bash
npm run stripe:preflight:live
```

Required result: zero `FAIL` entries. Review every `WARN`, especially active
test subscriptions and any paid storage entitlement without a live
subscription. The command prints no secret values and performs no writes.

## 6. Approved cutover

Do this only inside an announced maintenance window:

1. Export/back up `plans`, `subscriptions`, and `user_storage_usage`.
2. Resolve test users whose paid storage entitlement must not carry into Live.
3. Set the Vercel Production values together:
   - `STRIPE_MODE=live`
   - `STRIPE_LIVE_ENABLED=true`
   - `STRIPE_SECRET_KEY=rk_live_...`
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_...` for the live endpoint
4. Redeploy Ciiya. Railway photo/face workers do not need Stripe keys.
5. Run one low-value real subscription with a dedicated canary account.
6. Confirm Checkout, webhook delivery, `subscriptions.stripe_mode=live`, quota,
   invoice receipt, Customer Portal, cancellation, and refund behavior.
7. Check Vercel logs and Stripe Workbench without logging credentials or full
   payment/customer data.

## 7. Rollback

The database keeps both price mappings and separates subscription modes, so a
rollback does not require deleting live data:

1. Restore the prior Test runtime keys and webhook secret.
2. Set `STRIPE_MODE=test` and `STRIPE_LIVE_ENABLED=false`.
3. Redeploy and verify Test checkout.
4. Disable the live webhook only after the live canary subscription is safely
   canceled/refunded and no live events remain pending.

Never delete or overwrite Test or Live Stripe objects as part of rollback.
