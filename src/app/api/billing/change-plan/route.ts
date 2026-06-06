import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import {
  PLAN_LIMITS,
  type PlanKey,
} from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env')
  }

  return createClient(url, key)
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
        },
        {
          status: 401,
        }
      )
    }

    const body = await req.json()

    const nextPlan = String(body.plan || '') as PlanKey

    if (!PLAN_LIMITS[nextPlan]) {
      return NextResponse.json(
        {
          error: 'Invalid plan',
        },
        {
          status: 400,
        }
      )
    }

    const admin = getAdmin()

    const { data: usage, error } = await admin
      .from('user_storage_usage')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error || !usage) {
      return NextResponse.json(
        {
          error: 'Usage not found',
        },
        {
          status: 404,
        }
      )
    }

    const currentPlan =
      usage.current_plan as PlanKey

    const currentLimit =
      PLAN_LIMITS[currentPlan].storageBytes

    const nextLimit =
      PLAN_LIMITS[nextPlan].storageBytes

    const currentUsage =
      Number(usage.storage_used_bytes || 0)

    const isUpgrade = nextLimit > currentLimit

    // ======================
    // UPGRADE
    // ======================

    if (isUpgrade) {
      const { error: upgradeError } = await admin
        .from('user_storage_usage')
        .update({
          current_plan: nextPlan,
          storage_limit_bytes: nextLimit,
          pending_plan: null,
          downgrade_scheduled_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)

      if (upgradeError) {
        return NextResponse.json(
          {
            error: upgradeError.message,
          },
          {
            status: 500,
          }
        )
      }

      return NextResponse.json({
        success: true,
        type: 'upgrade',
        currentPlan: nextPlan,
      })
    }

    // ======================
    // DOWNGRADE CHECK
    // ======================

    if (currentUsage > nextLimit) {
      return NextResponse.json(
        {
          error:
            'Current storage exceeds target plan limit',
          currentUsage,
          nextLimit,
        },
        {
          status: 400,
        }
      )
    }

    // ======================
    // SCHEDULE DOWNGRADE
    // ======================

    const periodEnd =
      usage.current_period_end ||
      new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toISOString()

    const { error: downgradeError } = await admin
      .from('user_storage_usage')
      .update({
        pending_plan: nextPlan,
        downgrade_scheduled_at: new Date().toISOString(),
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    if (downgradeError) {
      return NextResponse.json(
        {
          error: downgradeError.message,
        },
        {
          status: 500,
        }
      )
    }

    return NextResponse.json({
      success: true,
      type: 'downgrade_scheduled',
      currentPlan,
      nextPlan,
      effectiveAt: periodEnd,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Change plan failed',
      },
      {
        status: 500,
      }
    )
  }
}