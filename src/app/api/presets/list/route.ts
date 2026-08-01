import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase.storage
      .from('presets')
      .list(`${user.id}/presets`, {
        limit: 100,
        sortBy: {
          column: 'created_at',
          order: 'desc',
        },
      })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const presets = (data || [])
      .filter((item) => item.name.toLowerCase().endsWith('.xmp'))
      .map((item) => {
        const path = `${user.id}/presets/${item.name}`
        const cleanName = item.name
          .replace(/^\d+-/, '')
          .replace(/\.xmp$/i, '')

        return {
          name: cleanName,
          fileName: item.name,
          path,
          createdAt: item.created_at || null,
        }
      })

    return NextResponse.json({
      success: true,
      presets,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'List presets failed',
      },
      { status: 500 }
    )
  }
}