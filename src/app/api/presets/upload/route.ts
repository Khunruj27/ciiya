import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSafeFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^/.]+$/, '')

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  return `${Date.now()}-${safeBaseName || 'preset'}.xmp`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Missing preset file' },
        { status: 400 }
      )
    }

    if (!file.name.toLowerCase().endsWith('.xmp')) {
      return NextResponse.json(
        { success: false, error: 'Only .xmp allowed' },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    if (buffer.length <= 0) {
      return NextResponse.json(
        { success: false, error: 'Preset file is empty' },
        { status: 400 }
      )
    }

    const safeFileName = getSafeFileName(file.name)
    const path = `${user.id}/presets/${safeFileName}`

    const { error } = await supabase.storage
      .from('presets')
      .upload(path, buffer, {
        contentType: 'application/xml',
        upsert: false,
      })

    if (error) {
      console.error('[presets/upload] storage upload failed:', error)

      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      path,
      name: file.name.replace(/\.xmp$/i, ''),
    })
  } catch (error) {
    console.error('[presets/upload] failed:', error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Upload preset failed',
      },
      { status: 500 }
    )
  }
}