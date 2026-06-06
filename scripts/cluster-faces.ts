import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const TARGET_ALBUM_ID = process.env.CLUSTER_ALBUM_ID || null
const SIMILARITY_THRESHOLD = Number(process.env.FACE_CLUSTER_THRESHOLD || 0.52)
const MIN_CONFIDENCE = Number(process.env.FACE_CLUSTER_MIN_CONFIDENCE || 0.5)
const LIMIT = Number(process.env.FACE_CLUSTER_LIMIT || 5000)
const DRY_RUN = process.env.FACE_CLUSTER_DRY_RUN === 'true'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
  transport: WebSocket as unknown as typeof globalThis.WebSocket,
},
})

type FaceRow = {
  id: string
  photo_id: string
  album_id: string | null
  owner_id: string | null
  confidence: number | null
  descriptor: number[] | null
  created_at: string
}

type FaceCluster = {
  id?: string
  album_id: string | null
  owner_id: string | null
  faces: FaceRow[]
  centroid: number[]
}

function euclideanDistance(a: number[], b: number[]) {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY

  let sum = 0

  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }

  return Math.sqrt(sum)
}

function averageDescriptor(descriptors: number[][]) {
  const length = descriptors[0]?.length || 0
  const avg = Array.from({ length }, () => 0)

  for (const descriptor of descriptors) {
    for (let i = 0; i < length; i += 1) {
      avg[i] += descriptor[i]
    }
  }

  return avg.map((value) => value / descriptors.length)
}

function normalizeDescriptor(value: unknown) {
  if (!Array.isArray(value)) return null

  const numbers = value.map(Number).filter(Number.isFinite)

  if (numbers.length < 64) return null

  return numbers
}

async function getFaces() {
  let query = supabase
    .from('photo_faces')
    .select(
      `
      id,
      photo_id,
      album_id,
      owner_id,
      confidence,
      descriptor,
      created_at
      `
    )
    .not('descriptor', 'is', null)
    .gte('confidence', MIN_CONFIDENCE)
    .order('created_at', { ascending: true })
    .limit(LIMIT)

  if (TARGET_ALBUM_ID) {
    query = query.eq('album_id', TARGET_ALBUM_ID)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data || [])
    .map((face) => ({
      ...face,
      descriptor: normalizeDescriptor(face.descriptor),
    }))
    .filter((face): face is FaceRow => Boolean(face.descriptor))
}

function clusterFaces(faces: FaceRow[]) {
  const clusters: FaceCluster[] = []

  for (const face of faces) {
    if (!face.descriptor) continue

    let bestCluster: FaceCluster | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (const cluster of clusters) {
      if (cluster.album_id !== face.album_id) continue

      const distance = euclideanDistance(face.descriptor, cluster.centroid)

      if (distance < bestDistance) {
        bestDistance = distance
        bestCluster = cluster
      }
    }

    if (bestCluster && bestDistance <= SIMILARITY_THRESHOLD) {
      bestCluster.faces.push(face)
      bestCluster.centroid = averageDescriptor(
        bestCluster.faces
          .map((item) => item.descriptor)
          .filter(Boolean) as number[][]
      )
    } else {
      clusters.push({
        album_id: face.album_id,
        owner_id: face.owner_id,
        faces: [face],
        centroid: face.descriptor,
      })
    }
  }

  return clusters
}

async function resetExistingClusters(albumId: string | null) {
  if (DRY_RUN) return

  let facesQuery = supabase
    .from('photo_faces')
    .update({
      cluster_id: null,
      person_cluster_id: null,
    })
    .not('descriptor', 'is', null)

  let clustersQuery = supabase.from('face_clusters').delete()

  if (albumId) {
    facesQuery = facesQuery.eq('album_id', albumId)
    clustersQuery = clustersQuery.eq('album_id', albumId)
  } else {
    clustersQuery = clustersQuery.not('id', 'is', null)
  }

  const { error: facesError } = await facesQuery

  if (facesError) throw new Error(facesError.message)

  const { error: clustersError } = await clustersQuery

  if (clustersError) throw new Error(clustersError.message)
}

async function saveClusters(clusters: FaceCluster[]) {
  let saved = 0

  for (const cluster of clusters) {
    const previewFace = cluster.faces[0]
    const previewPhotoId = previewFace?.photo_id || null

    if (!previewFace) continue

    if (DRY_RUN) {
      console.log(
        `[DRY RUN] cluster album=${cluster.album_id} faces=${cluster.faces.length}`
      )
      saved += 1
      continue
    }

    const { data: createdCluster, error: clusterError } = await supabase
      .from('face_clusters')
      .insert({
        album_id: cluster.album_id,
        owner_id: cluster.owner_id,
        label: null,
        preview_photo_id: previewPhotoId,
        face_count: cluster.faces.length,
      })
      .select('id')
      .single()

    if (clusterError || !createdCluster) {
      throw new Error(clusterError?.message || 'Cannot create face cluster')
    }

    const faceIds = cluster.faces.map((face) => face.id)

    const { error: updateError } = await supabase
      .from('photo_faces')
      .update({
        cluster_id: createdCluster.id,
        person_cluster_id: createdCluster.id,
      })
      .in('id', faceIds)

    if (updateError) {
      throw new Error(updateError.message)
    }

    saved += 1
  }

  return saved
}

async function run() {
  console.log('\n==============================')
  console.log('CIIYA FACE CLUSTERING')
  console.log('==============================')
  console.log('DRY_RUN =', DRY_RUN)
  console.log('TARGET_ALBUM_ID =', TARGET_ALBUM_ID || 'all')
  console.log('THRESHOLD =', SIMILARITY_THRESHOLD)
  console.log('MIN_CONFIDENCE =', MIN_CONFIDENCE)

  const faces = await getFaces()

  console.log('Faces found:', faces.length)

  if (faces.length === 0) {
    console.log('No faces to cluster')
    return
  }

  const clusters = clusterFaces(faces)

  console.log('Clusters generated:', clusters.length)

  await resetExistingClusters(TARGET_ALBUM_ID)

  const saved = await saveClusters(clusters)

  console.log('Clusters saved:', saved)
  console.log('==============================')
  console.log('DONE')
  console.log('==============================\n')
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[ClusterFaces] fatal:', error)
    process.exit(1)
  })