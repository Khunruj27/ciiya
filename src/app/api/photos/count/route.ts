import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      console.error(
        '[photos/count] authentication failed:',
        authError.message
      )

      return NextResponse.json(
        { error: 'Unable to verify authentication' },
        { status: 500 }
      )
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { count, error } = await supabase
      .from('photos')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .or(
        `owner_id.eq.${user.id},user_id.eq.${user.id}`
      )

    if (error) {
      console.error(
        '[photos/count] count query failed:',
        error.message
      )

      return NextResponse.json(
        { error: 'Unable to load photo count' },
        { status: 500 }
      )
    }

    const total =
      typeof count === 'number' &&
      Number.isSafeInteger(count) &&
      count >= 0
        ? count
        : 0

    return NextResponse.json({
      success: true,
      total,
    })
  } catch (error) {
    console.error(
      '[photos/count] unexpected error:',
      error
    )

    return NextResponse.json(
      { error: 'Unable to load photo count' },
      { status: 500 }
    )
  }
}