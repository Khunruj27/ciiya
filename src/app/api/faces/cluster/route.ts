import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SupabaseAdminClient = SupabaseClient

type FaceRecord = {
  id: string
  photo_id: string | null
  album_id: string | null
  owner_id: string | null
  descriptor?: unknown
  embedding?: unknown
  confidence?: number | null
}

type FaceCluster = {
  center: number[]
  items: FaceRecord[]
}

function getSupabaseAdmin(): SupabaseAdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase admin env')
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

function euclidean(a: number[], b: number[]) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return Infinity
  }

  return Math.sqrt(a.reduce((sum, val, i) => sum + (val - b[i]) ** 2, 0))
}

function normalizeVector(value: unknown): number[] | null {
  try {
    const vector = typeof value === 'string' ? JSON.parse(value) : value

    if (!Array.isArray(vector)) return null

    const numbers = vector.map((item) => Number(item))

    if (numbers.some((item) => Number.isNaN(item))) return null

    return numbers
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const supabaseAdmin = getSupabaseAdmin()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const albumId = String(body?.albumId || '').trim()

    if (!albumId) {
      return NextResponse.json(
        { error: 'albumId is required' },
        { status: 400 }
      )
    }

    const { data: facesData, error } = await supabaseAdmin
      .from('photo_faces')
      .select('id, photo_id, album_id, owner_id, descriptor, embedding, confidence')
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const faces = (facesData || []) as FaceRecord[]

    if (!faces.length) {
      return NextResponse.json({
        success: true,
        clusters: 0,
        faces: 0,
        message: 'No faces',
      })
    }

    await supabaseAdmin
      .from('face_clusters')
      .delete()
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    await supabaseAdmin
      .from('photo_faces')
      .update({
        cluster_id: null,
        person_cluster_id: null,
      })
      .eq('album_id', albumId)
      .eq('owner_id', user.id)

    const threshold = Number(process.env.FACE_CLUSTER_THRESHOLD || 0.52)
    const clusters: FaceCluster[] = []

    for (const face of faces) {
      const vector =
        normalizeVector(face.descriptor) || normalizeVector(face.embedding)

      if (!vector) continue

      let foundCluster: FaceCluster | null = null

      for (const cluster of clusters) {
        const dist = euclidean(vector, cluster.center)

        if (dist < threshold) {
          foundCluster = cluster
          break
        }
      }

      if (foundCluster) {
        foundCluster.items.push(face)

        const total = foundCluster.items.length
        foundCluster.center = foundCluster.center.map((value, index) => {
          return value + (vector[index] - value) / total
        })
      } else {
        clusters.push({
          center: vector,
          items: [face],
        })
      }
    }

    for (let i = 0; i < clusters.length; i += 1) {
      const cluster = clusters[i]
      const previewPhotoId = cluster.items[0]?.photo_id ?? null

      const { data: newCluster, error: insertError } = await supabaseAdmin
        .from('face_clusters')
        .insert({
          owner_id: user.id,
          album_id: albumId,
          label: `Person ${i + 1}`,
          preview_photo_id: previewPhotoId,
          face_count: cluster.items.length,
        })
        .select('id')
        .single()

      if (insertError || !newCluster) {
        return NextResponse.json(
          { error: insertError?.message || 'Create cluster failed' },
          { status: 500 }
        )
      }

      const ids = cluster.items.map((item) => item.id)

      const { error: updateError } = await supabaseAdmin
        .from('photo_faces')
        .update({
          cluster_id: newCluster.id,
          person_cluster_id: newCluster.id,
        })
        .in('id', ids)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      clusters: clusters.length,
      faces: faces.length,
    })
  } catch (err) {
    console.error(err)

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Cluster failed',
      },
      { status: 500 }
    )
  }
}