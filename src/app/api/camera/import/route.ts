import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const MOCK_JPG_FILES: Array<[string, number]> = [
  ['IMG_0001.JPG', 8_500_000],
  ['IMG_0002.JPG', 7_800_000],
  ['IMG_0003.JPG', 9_100_000],
  ['IMG_0004.JPG', 8_200_000],
  ['IMG_0005.JPG', 7_700_000],
]

function isJpgFile(filename: string) {
  const lower = filename.toLowerCase()
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg')
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const albumId = String(body?.albumId || '').trim()

    if (!albumId) {
      return NextResponse.json({ error: 'Missing albumId' }, { status: 400 })
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, owner_id')
      .eq('id', albumId)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (albumError || !album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    const jpgFiles = MOCK_JPG_FILES.filter(([filename]) => isJpgFile(filename))

    const { data: importJob, error: jobError } = await supabase
      .from('camera_import_jobs')
      .insert({
        album_id: albumId,
        status: 'pending',
        total_files: jpgFiles.length,
        processed_files: 0,
        camera_brand: 'Canon',
        camera_model: 'EOS R6',
      })
      .select('id, album_id, status, total_files, processed_files, camera_brand, camera_model, created_at')
      .single()

    if (jobError || !importJob) {
      return NextResponse.json(
        { error: jobError?.message || 'Create import job failed' },
        { status: 500 }
      )
    }

    const fileRows = jpgFiles.map(([filename, fileSize]) => ({
      import_job_id: importJob.id,
      album_id: albumId,
      user_id: user.id,
      filename,
      file_size: fileSize,
      status: 'pending',
      progress: 0,
    }))

    const { data: files, error: filesError } = await supabase
      .from('camera_import_files')
      .insert(fileRows)
      .select('id, import_job_id, filename, file_size, status, progress, created_at')

    if (filesError) {
      return NextResponse.json({ error: filesError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      importJob,
      files: files || [],
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Create import jobs failed',
      },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const albumId = searchParams.get('albumId')

    if (!albumId) {
      return NextResponse.json({ error: 'Missing albumId' }, { status: 400 })
    }

    const { data: jobs, error: jobsError } = await supabase
      .from('camera_import_jobs')
      .select('id, album_id, status, total_files, processed_files, camera_brand, camera_model, created_at, updated_at')
      .eq('album_id', albumId)
      .order('created_at', { ascending: false })
      .limit(5)

    if (jobsError) {
      return NextResponse.json({ error: jobsError.message }, { status: 500 })
    }

    const { data: files, error: filesError } = await supabase
      .from('camera_import_files')
      .select('id, import_job_id, filename, file_size, status, progress, created_at')
      .eq('album_id', albumId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (filesError) {
      return NextResponse.json({ error: filesError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      jobs: jobs || [],
      files: files || [],
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Fetch import jobs failed',
      },
      { status: 500 }
    )
  }
}