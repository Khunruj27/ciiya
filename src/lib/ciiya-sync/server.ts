import crypto from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const CIIYA_SYNC_PAIRING_TTL_SECONDS = 10 * 60
export const CIIYA_SYNC_DEVICE_TOKEN_TTL_DAYS = 90
export const CIIYA_SYNC_POLL_INTERVAL_SECONDS = 3

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEVICE_TOKEN_PATTERN = /^ciiya_sync_[A-Za-z0-9_-]{43}$/

export type CiiyaSyncPlatform = 'macos' | 'windows' | 'linux' | 'unknown'

export type CiiyaSyncDevice = {
  id: string
  owner_id: string
  client_device_id: string
  name: string
  platform: CiiyaSyncPlatform
  app_version: string | null
  scopes: string[]
  token_expires_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

let adminClient: SupabaseClient | null = null

export function getCiiyaSyncAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) return null

  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  return adminClient
}

export function hashCiiyaSyncSecret(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

export function normalizeCiiyaSyncPlatform(
  value: unknown
): CiiyaSyncPlatform {
  const platform = String(value || '').trim().toLowerCase()

  if (platform === 'macos') return 'macos'
  if (platform === 'windows') return 'windows'
  if (platform === 'linux') return 'linux'
  return 'unknown'
}

export function normalizeCiiyaSyncDeviceName(value: unknown) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 80)
}

export function normalizeCiiyaSyncUserCode(value: unknown) {
  const normalized = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

  if (normalized.length !== 8) return null
  if ([...normalized].some((character) => !USER_CODE_ALPHABET.includes(character))) {
    return null
  }

  return normalized
}

export function formatCiiyaSyncUserCode(value: string) {
  return `${value.slice(0, 4)}-${value.slice(4)}`
}

function randomUserCode() {
  let result = ''

  for (let index = 0; index < 8; index += 1) {
    result += USER_CODE_ALPHABET[crypto.randomInt(0, USER_CODE_ALPHABET.length)]
  }

  return result
}

export function createCiiyaSyncPairingCredentials() {
  const userCode = randomUserCode()
  const pollSecret = crypto.randomBytes(32).toString('base64url')

  return {
    userCode,
    formattedUserCode: formatCiiyaSyncUserCode(userCode),
    userCodeHash: hashCiiyaSyncSecret(userCode),
    pollSecret,
    pollSecretHash: hashCiiyaSyncSecret(pollSecret),
  }
}

export function createCiiyaSyncDeviceToken() {
  return `ciiya_sync_${crypto.randomBytes(32).toString('base64url')}`
}

export async function authenticateCiiyaSyncDevice(
  request: Request,
  requiredScope?: string
): Promise<{
  admin: SupabaseClient
  device: CiiyaSyncDevice
} | null> {
  const authorization = request.headers.get('authorization') || ''
  const [scheme, token, ...extra] = authorization.trim().split(/\s+/)

  if (
    extra.length > 0 ||
    scheme?.toLowerCase() !== 'bearer' ||
    !token ||
    !DEVICE_TOKEN_PATTERN.test(token)
  ) {
    return null
  }

  const admin = getCiiyaSyncAdminClient()
  if (!admin) return null

  const { data, error } = await admin
    .from('ciiya_sync_devices')
    .select(
      'id,owner_id,client_device_id,name,platform,app_version,scopes,token_expires_at,last_seen_at,revoked_at'
    )
    .eq('token_hash', hashCiiyaSyncSecret(token))
    .is('revoked_at', null)
    .gt('token_expires_at', new Date().toISOString())
    .maybeSingle()

  if (error || !data) return null

  const device = data as CiiyaSyncDevice
  if (requiredScope && !device.scopes.includes(requiredScope)) return null

  const lastSeenAt = device.last_seen_at
    ? new Date(device.last_seen_at).getTime()
    : 0

  if (Date.now() - lastSeenAt > 5 * 60 * 1000) {
    await admin
      .from('ciiya_sync_devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', device.id)
      .eq('owner_id', device.owner_id)
      .is('revoked_at', null)
  }

  return { admin, device }
}
