import { config } from 'dotenv'

config({
  path: '.env.local',
})

import { createClient } from '@supabase/supabase-js'
import {
  PLAN_LIMITS,
  type PlanKey,
} from '../src/lib/plans'

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

async function applyDowngrades() {
  console.log('Checking scheduled downgrades...')

  const now = new Date().toISOString()

  const { data: users, error } = await supabase
    .from('user_storage_usage')
    .select('*')
    .not('pending_plan', 'is', null)
    .lte('current_period_end', now)

  if (error) {
    throw new Error(error.message)
  }

  if (!users || users.length === 0) {
    console.log('No scheduled downgrades')
    return
  }

  console.log(`Found ${users.length} scheduled downgrade(s)`)

  for (const user of users) {
    try {
      const nextPlan =
        String(user.pending_plan) as PlanKey

      const nextPlanConfig =
        PLAN_LIMITS[nextPlan]

      if (!nextPlanConfig) {
        console.log(
          `Invalid plan for user ${user.user_id}`
        )

        continue
      }

      const currentUsage = Number(
        user.storage_used_bytes || 0
      )

      // SAFETY CHECK
      if (
        currentUsage >
        nextPlanConfig.storageBytes
      ) {
        console.log(
          `Skip downgrade user=${user.user_id} usage exceeds limit`
        )

        continue
      }

      const nextPeriodEnd = new Date(
        Date.now() +
          30 * 24 * 60 * 60 * 1000
      ).toISOString()

      const { error: updateError } =
        await supabase
          .from('user_storage_usage')
          .update({
            current_plan: nextPlan,
            storage_limit_bytes:
              nextPlanConfig.storageBytes,

            pending_plan: null,
            downgrade_scheduled_at: null,

            current_period_end:
              nextPeriodEnd,

            updated_at:
              new Date().toISOString(),
          })
          .eq('user_id', user.user_id)

      if (updateError) {
        console.error(
          `Downgrade failed ${user.user_id}:`,
          updateError.message
        )

        continue
      }

      console.log(
        `Downgrade applied user=${user.user_id} -> ${nextPlan}`
      )
    } catch (error) {
      console.error(error)
    }
  }

  console.log('Billing cron completed')
}

applyDowngrades()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })