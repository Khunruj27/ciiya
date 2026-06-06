import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'albums'
const MAX_DELETE_PER_RUN = 100

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
    }
  }

  const isAdmin = getAdminEmails().includes(user.email.toLowerCase())

  if (!isAdmin) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden',
    }
  }

  return {
    ok: true,
    status: 200,
    error: null,
  }
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

async function listFilesRecursive(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  prefix: string,
  output: string[] = []
) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(prefix, {
      limit: 1000,
      sortBy: {
        column: 'name',
        order: 'asc',
      },
    })

  if (error) throw new Error(error.message)

  for (const item of data || []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name

    if (item.metadata) {
      output.push(path)
    } else {
      await listFilesRecursive(supabase, path, output)
    }
  }

  return output
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()

    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.error },
        { status: admin.status }
      )
    }

    const body = await req.json().catch(() => ({}))
    const dryRun = body.dryRun !== false
    const prefix = String(body.prefix || '').trim()

    const supabase = getSupabaseAdmin()

    const allStorageFiles = await listFilesRecursive(supabase, prefix)

    const { data: photos, error: photosError } = await supabase
      .from('photos')
      .select(
        `
        original_path,
        storage_path,
        preview_path,
        thumbnail_path,
        sd_path,
        hd_path,
        uhd_path
        `
      )

    if (photosError) {
      throw new Error(photosError.message)
    }

    const usedPaths = new Set<string>()

    for (const photo of photos || []) {
      for (const key of [
        'original_path',
        'storage_path',
        'preview_path',
        'thumbnail_path',
        'sd_path',
        'hd_path',
        'uhd_path',
      ]) {
        const value = photo[key as keyof typeof photo]

        if (typeof value === 'string' && value.trim()) {
          usedPaths.add(value)
        }
      }
    }

    const orphanFiles = allStorageFiles.filter((path) => !usedPaths.has(path))
    const targetFiles = orphanFiles.slice(0, MAX_DELETE_PER_RUN)

    if (!dryRun && targetFiles.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove(targetFiles)

      if (removeError) {
        throw new Error(removeError.message)
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      bucket: BUCKET,
      prefix,
      scanned: allStorageFiles.length,
      used: usedPaths.size,
      orphanCount: orphanFiles.length,
      deletedCount: dryRun ? 0 : targetFiles.length,
      limit: MAX_DELETE_PER_RUN,
      sample: orphanFiles.slice(0, 20),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Cleanup orphan failed',
      },
      { status: 500 }
    )
  }
}