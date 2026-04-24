import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    const albumId = String(body.albumId || '').trim()
    const title = String(body.title || '').trim()
    const description = String(body.description || '').trim()
    const allowDownload = Boolean(body.allowDownload)
    const isPasswordProtected = Boolean(body.isPasswordProtected)
    const password = String(body.password || '').trim()

    if (!albumId) {
      return NextResponse.json({ error: 'albumId is required' }, { status: 400 })
    }

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const { data: album, error: albumError } = await supabase
      .from('albums')
      .select('id, owner_id')
      .eq('id', albumId)
      .eq('owner_id', user.id)
      .single()

    if (albumError || !album) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 })
    }

    let passwordHash: string | null | undefined = undefined

    if (isPasswordProtected) {
      if (password) {
        passwordHash = await bcrypt.hash(password, 10)
      }
    } else {
      passwordHash = null
    }

    const updatePayload: {
      title: string
      description: string | null
      allow_download: boolean
      is_password_protected: boolean
      password_hash?: string | null
    } = {
      title,
      description: description || null,
      allow_download: allowDownload,
      is_password_protected: isPasswordProtected,
    }

    if (passwordHash !== undefined) {
      updatePayload.password_hash = passwordHash
    }

    const { error: updateError } = await supabase
      .from('albums')
      .update(updatePayload)
      .eq('id', albumId)
      .eq('owner_id', user.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      { status: 500 }
    )
  }
}