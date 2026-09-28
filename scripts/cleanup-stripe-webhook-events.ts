import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'

loadEnvConfig(process.cwd())

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const retentionDays = Number(
  process.env.STRIPE_WEBHOOK_LEDGER_RETENTION_DAYS || 90
)
const apply =
  process.env.STRIPE_WEBHOOK_LEDGER_CLEANUP_APPLY_ENABLED?.trim().toLowerCase() ===
  'true'

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing production Supabase credentials.')
}

if (!Number.isInteger(retentionDays) || retentionDays < 30) {
  throw new Error(
    'STRIPE_WEBHOOK_LEDGER_RETENTION_DAYS must be an integer of at least 30.'
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1_000
  ).toISOString()
  const baseQuery = () =>
    supabase
      .from('stripe_webhook_events')
      .select('event_id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .lt('completed_at', cutoff)

  const { count, error: countError } = await baseQuery()

  if (countError) {
    throw new Error(`Cannot audit Stripe webhook ledger: ${countError.message}`)
  }

  if (!apply) {
    console.log(
      `Dry run: ${count || 0} completed Stripe webhook event(s) are older than ${retentionDays} days. No rows deleted.`
    )
    return
  }

  const { error: deleteError } = await supabase
    .from('stripe_webhook_events')
    .delete()
    .eq('status', 'completed')
    .lt('completed_at', cutoff)

  if (deleteError) {
    throw new Error(`Stripe webhook ledger cleanup failed: ${deleteError.message}`)
  }

  console.log(
    `Deleted ${count || 0} completed Stripe webhook event(s) older than ${retentionDays} days.`
  )
}

main().catch((error) => {
  console.error(
    'Stripe webhook ledger cleanup stopped safely:',
    error instanceof Error ? error.message : 'Unknown error'
  )
  process.exitCode = 1
})
