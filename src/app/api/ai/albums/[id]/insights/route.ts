import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { buildAlbumInsights, type AlbumInsightSnapshot } from '@/lib/ai/album-insights'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000
const LOCAL_TZ = 'Asia/Bangkok'

type PhotoRow = {
  id: string
  filename: string | null
  file_name: string | null
  view_count: number | null
  download_count: number | null
  like_count: number | null
}

type ShareEventRow = {
  event_type: string
  created_at: string
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase admin env')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function localHour(iso: string) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TZ,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso)))
}

function sum(rows: PhotoRow[], key: 'view_count' | 'download_count' | 'like_count') {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0)
}

async function requireOwnedAlbum(id: string) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: album, error } = await supabase
    .from('albums')
    .select('id, owner_id, title, cover_url, view_count, is_public')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (error || !album) {
    return { error: NextResponse.json({ error: 'Album not found' }, { status: 404 }) }
  }

  return { supabase, user, album }
}

async function collectSnapshot(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  album: {
    id: string
    title: string | null
    cover_url: string | null
    view_count: number | null
    is_public: boolean | null
  },
  ownerId: string
): Promise<AlbumInsightSnapshot> {
  const now = new Date()
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString()
  const since14 = new Date(now.getTime() - 14 * DAY_MS)
  const since7 = new Date(now.getTime() - 7 * DAY_MS)

  const [{ data: photos }, { data: events }, moments] = await Promise.all([
    supabase
      .from('photos')
      .select('id, filename, file_name, view_count, download_count, like_count')
      .eq('album_id', album.id)
      .eq('owner_id', ownerId),
    supabase
      .from('share_events')
      .select('event_type, created_at')
      .eq('album_id', album.id)
      .eq('owner_id', ownerId)
      .gte('created_at', since30),
    supabase
      .from('guest_moments')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', album.id)
      .eq('status', 'published'),
  ])

  const safePhotos = (photos || []) as PhotoRow[]
  const safeEvents = (events || []) as ShareEventRow[]
  const hourCounts = Array.from({ length: 24 }, () => 0)
  for (const event of safeEvents) hourCounts[localHour(event.created_at)] += 1
  const eventTotal = hourCounts.reduce((total, count) => total + count, 0)
  const peakHour = eventTotal
    ? hourCounts.reduce((best, count, index) => count > hourCounts[best] ? index : best, 0)
    : null

  const topPhoto = safePhotos
    .map((photo) => ({
      id: photo.id,
      filename: photo.filename || photo.file_name || 'ภาพถ่าย',
      views: Number(photo.view_count || 0),
      downloads: Number(photo.download_count || 0),
      hearts: Number(photo.like_count || 0),
      score: Number(photo.view_count || 0) + Number(photo.download_count || 0) * 3 + Number(photo.like_count || 0) * 2,
    }))
    .sort((a, b) => b.score - a.score)[0] || null

  return {
    albumTitle: album.title || 'แกลเลอรีไม่มีชื่อ',
    isPublic: album.is_public === true,
    hasCover: Boolean(album.cover_url),
    photoCount: safePhotos.length,
    galleryViews: Number(album.view_count || 0),
    recentViews: safeEvents.filter((event) => event.event_type === 'album_view').length,
    previousWeekViews: safeEvents.filter((event) => {
      const created = new Date(event.created_at)
      return event.event_type === 'album_view' && created >= since14 && created < since7
    }).length,
    currentWeekViews: safeEvents.filter((event) => event.event_type === 'album_view' && new Date(event.created_at) >= since7).length,
    downloads: sum(safePhotos, 'download_count'),
    hearts: sum(safePhotos, 'like_count'),
    faceSearches: safeEvents.filter((event) => event.event_type === 'face_search').length,
    guestMoments: Number(moments.count || 0),
    photoOpens: sum(safePhotos, 'view_count'),
    peakHour,
    topPhoto,
  }
}

function isMissingAiSchema(error: { code?: string | null } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

export async function GET(_request: NextRequest, context: RouteContext<'/api/ai/albums/[id]/insights'>) {
  const { id } = await context.params
  const auth = await requireOwnedAlbum(id)
  if ('error' in auth) return auth.error

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('ai_jobs')
    .select('id, status, output, created_at, completed_at')
    .eq('owner_id', auth.user.id)
    .eq('album_id', id)
    .eq('feature', 'analytics_summary')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (isMissingAiSchema(error)) {
    return NextResponse.json({ insight: null, persisted: false })
  }
  if (error) return NextResponse.json({ error: 'Unable to load AI insights' }, { status: 500 })

  return NextResponse.json({ insight: data?.output || null, jobId: data?.id || null, persisted: true })
}

export async function POST(request: NextRequest, context: RouteContext<'/api/ai/albums/[id]/insights'>) {
  const { id } = await context.params
  const auth = await requireOwnedAlbum(id)
  if ('error' in auth) return auth.error

  const body = await request.json().catch(() => ({}))
  const force = body?.force === true
  const admin = getAdminClient()
  const reuseAfter = new Date(Date.now() - 5 * 60_000).toISOString()

  if (!force) {
    const { data: recent } = await admin
      .from('ai_jobs')
      .select('id, output')
      .eq('owner_id', auth.user.id)
      .eq('album_id', id)
      .eq('feature', 'analytics_summary')
      .eq('status', 'completed')
      .gte('created_at', reuseAfter)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recent?.output) {
      return NextResponse.json({ insight: recent.output, jobId: recent.id, persisted: true, reused: true })
    }
  }

  let jobId: string | null = null
  let persisted = true
  const { data: job, error: jobError } = await admin
    .from('ai_jobs')
    .insert({
      owner_id: auth.user.id,
      album_id: id,
      feature: 'analytics_summary',
      status: 'processing',
      progress: 20,
      attempts: 1,
      started_at: new Date().toISOString(),
      input: { source: 'album_analytics', range_days: 30 },
    })
    .select('id')
    .single()

  if (jobError) {
    if (!isMissingAiSchema(jobError)) {
      console.error('[ai/album-insights] unable to create job:', jobError)
      return NextResponse.json({ error: 'Unable to start AI analysis' }, { status: 500 })
    }
    persisted = false
  } else {
    jobId = job.id
  }

  try {
    const snapshot = await collectSnapshot(auth.supabase, auth.album, auth.user.id)
    const insight = buildAlbumInsights(snapshot)

    if (jobId) {
      const suggestions = insight.recommendations.map((item) => ({
        job_id: jobId,
        owner_id: auth.user.id,
        album_id: id,
        feature: 'analytics_summary',
        suggestion_type: item.id,
        title: item.title,
        summary: item.detail,
        payload: { priority: item.priority, actionLabel: item.actionLabel, actionHref: item.actionHref },
        confidence: item.priority === 'high' ? 0.95 : item.priority === 'medium' ? 0.85 : 0.75,
      }))

      const [{ error: updateError }, { error: suggestionError }] = await Promise.all([
        admin.from('ai_jobs').update({
          status: 'completed',
          progress: 100,
          output: insight,
          completed_at: new Date().toISOString(),
        }).eq('id', jobId).eq('owner_id', auth.user.id),
        suggestions.length ? admin.from('ai_suggestions').insert(suggestions) : Promise.resolve({ error: null }),
      ])

      if (updateError || suggestionError) {
        console.warn('[ai/album-insights] persistence partially failed:', updateError || suggestionError)
        persisted = false
      }

      await admin.from('ai_audit_logs').insert({
        owner_id: auth.user.id,
        job_id: jobId,
        feature: 'analytics_summary',
        action: 'analysis_completed',
        actor_type: 'system',
        metadata: { recommendation_count: insight.recommendations.length, engine: insight.version },
      })
    }

    return NextResponse.json({ insight, jobId, persisted })
  } catch (error) {
    if (jobId) {
      await admin.from('ai_jobs').update({
        status: 'failed',
        progress: 100,
        error_message: error instanceof Error ? error.message.slice(0, 500) : 'Analysis failed',
        completed_at: new Date().toISOString(),
      }).eq('id', jobId).eq('owner_id', auth.user.id)
    }
    console.error('[ai/album-insights] analysis failed:', error)
    return NextResponse.json({ error: 'Unable to analyze this gallery' }, { status: 500 })
  }
}
