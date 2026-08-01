import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function cleanPresetName(path: string) {
  const fileName = path.split('/').pop() || 'Preset'

  return fileName
    .replace(/^\d+-/, '')
    .replace(/\.xmp$/i, '')
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('camera_upload_sessions')
      .select('preset_path, created_at')
      .eq('owner_id', user.id)
      .not('preset_path', 'is', null)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const seen = new Set<string>()

    const presets = (data || [])
      .map((item) => String(item.preset_path || '').trim())
      .filter(Boolean)
      .filter((path) => {
        if (seen.has(path)) return false
        seen.add(path)
        return true
      })
      .slice(0, 3)
      .map((path) => ({
        path,
        name: cleanPresetName(path),
      }))

    return NextResponse.json({
      success: true,
      presets,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Load recent presets failed',
      },
      { status: 500 }
    )
  }
}