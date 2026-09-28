import { config } from 'dotenv'

config({
  path: '.env.local',
})

import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env')
}

const supabase = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

async function auditLegacyDowngrades() {
  console.log('Auditing legacy scheduled downgrades...')

  const { data: users, error } = await supabase
    .from('user_storage_usage')
    .select('user_id, pending_plan, downgrade_scheduled_at, current_period_end')
    .not('pending_plan', 'is', null)

  if (error) {
    throw new Error(error.message)
  }

  if (!users || users.length === 0) {
    console.log('No legacy scheduled downgrades')
    return
  }

  throw new Error(
    `${users.length} legacy scheduled downgrade(s) require manual Stripe/entitlement reconciliation. No quota was changed.`
  )
}

auditLegacyDowngrades()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
