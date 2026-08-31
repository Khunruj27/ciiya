import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TYPES = new Set(['feature', 'promotion', 'update', 'maintenance', 'tip', 'security'])
const PRIORITIES = new Set(['normal', 'important', 'critical'])
const PLANS = new Set(['free', 'starter', 'pro', 'business'])

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user?.email) return { ok: false as const, status: 401, user: null }

  const allowed = process.env.NODE_ENV === 'development' || getAdminEmails().includes(user.email.toLowerCase())
  return allowed
    ? { ok: true as const, status: 200, user }
    : { ok: false as const, status: 403, user: null }
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase admin env')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function cleanOptionalUrl(value: unknown, allowInternal = false) {
  const url = String(value || '').trim()
  if (!url) return null
  if (allowInternal && url.startsWith('/') && !url.startsWith('//')) return url.slice(0, 500)
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.toString().slice(0, 500)
  } catch {
    return null
  }
}

async function resolveAudienceValues(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  audienceType: string,
  rawValues: unknown
) {
  const values = Array.isArray(rawValues) ? rawValues.map(String) : []
  if (audienceType === 'all') return []

  if (audienceType === 'plans') {
    const plans = [...new Set(values.map((value) => value.trim().toLowerCase()))].filter((value) => PLANS.has(value))
    if (!plans.length) throw new Error('Choose at least one plan')
    return plans
  }

  if (audienceType === 'users') {
    const emails = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))]
    if (!emails.length) throw new Error('Enter at least one recipient email')

    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error) throw new Error('Unable to resolve recipients')
    const idByEmail = new Map((data.users || []).map((user) => [user.email?.toLowerCase(), user.id]))
    const missing = emails.filter((email) => !idByEmail.has(email))
    if (missing.length) throw new Error(`User not found: ${missing.slice(0, 3).join(', ')}`)
    return emails.map((email) => idByEmail.get(email) as string)
  }

  throw new Error('Invalid audience')
}

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: auth.status })

    const supabase = getSupabaseAdmin()
    const { data: announcements, error } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw new Error(error.message)

    const ids = (announcements || []).map((item) => item.id)
    const reads = ids.length
      ? await supabase.from('announcement_reads').select('announcement_id, clicked_at').in('announcement_id', ids)
      : { data: [], error: null }
    if (reads.error) throw new Error(reads.error.message)

    const stats = new Map<string, { reads: number; clicks: number }>()
    for (const row of reads.data || []) {
      const current = stats.get(row.announcement_id) || { reads: 0, clicks: 0 }
      current.reads += 1
      if (row.clicked_at) current.clicks += 1
      stats.set(row.announcement_id, current)
    }

    return NextResponse.json({
      success: true,
      announcements: (announcements || []).map((item) => ({
        ...item,
        read_count: stats.get(item.id)?.reads || 0,
        click_count: stats.get(item.id)?.clicks || 0,
      })),
    })
  } catch (error) {
    console.error('[admin/announcements] load failed:', error)
    return NextResponse.json({ error: 'Unable to load announcements' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok || !auth.user) return NextResponse.json({ error: 'Forbidden' }, { status: auth.status })

    const body = await req.json().catch(() => null)
    const title = String(body?.title || '').trim().slice(0, 120)
    const summary = String(body?.summary || '').trim().slice(0, 280)
    const announcementType = TYPES.has(body?.announcementType) ? body.announcementType : 'update'
    const priority = PRIORITIES.has(body?.priority) ? body.priority : 'normal'
    const audienceType = ['all', 'plans', 'users'].includes(body?.audienceType) ? body.audienceType : 'all'
    const requestedStatus = ['draft', 'published', 'scheduled'].includes(body?.status) ? body.status : 'draft'

    if (!title || !summary) {
      return NextResponse.json({ error: 'Title and summary are required' }, { status: 400 })
    }

    const startsAt = body?.startsAt ? new Date(body.startsAt) : new Date()
    const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null
    if (!Number.isFinite(startsAt.getTime())) return NextResponse.json({ error: 'Invalid start date' }, { status: 400 })
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= startsAt)) {
      return NextResponse.json({ error: 'Expiry must be after the start date' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const audienceValues = await resolveAudienceValues(supabase, audienceType, body?.audienceValues)
    const status = requestedStatus === 'scheduled' && startsAt <= new Date() ? 'published' : requestedStatus

    const { data, error } = await supabase
      .from('announcements')
      .insert({
        created_by: auth.user.id,
        announcement_type: announcementType,
        title,
        summary,
        body: String(body?.body || '').trim().slice(0, 5000) || null,
        image_url: cleanOptionalUrl(body?.imageUrl),
        cta_label: String(body?.ctaLabel || '').trim().slice(0, 40) || null,
        cta_url: cleanOptionalUrl(body?.ctaUrl, true),
        audience_type: audienceType,
        audience_values: audienceValues,
        priority,
        status,
        starts_at: startsAt.toISOString(),
        expires_at: expiresAt?.toISOString() || null,
        published_at: status === 'published' ? new Date().toISOString() : null,
      })
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, announcement: data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create announcement'
    const isValidationError = message.startsWith('User not found')
      || message.startsWith('Choose at least')
      || message.startsWith('Enter at least')
      || message === 'Invalid audience'
    console.error('[admin/announcements] create failed:', error)
    return NextResponse.json({ error: message }, { status: isValidationError ? 400 : 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: auth.status })
    const body = await req.json().catch(() => null)
    const id = String(body?.id || '').trim()
    const action = String(body?.action || '').trim()
    if (!id || !['publish', 'pause', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const payload = action === 'publish'
      ? { status: 'published', starts_at: new Date().toISOString(), published_at: new Date().toISOString() }
      : { status: action === 'pause' ? 'draft' : 'cancelled' }

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('announcements').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/announcements] update failed:', error)
    return NextResponse.json({ error: 'Unable to update announcement' }, { status: 500 })
  }
}
