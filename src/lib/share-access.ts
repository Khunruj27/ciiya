import crypto from 'crypto'

export type ShareAlbumGuardRow = {
  id: string
  is_public?: boolean | null
  status?: string | null
  is_password_protected?: boolean | null
  password_hash?: string | null
}

/**
 * True when an album is allowed to be shown on a public share link at all,
 * ignoring password protection (checked separately below).
 */
export function isAlbumPubliclyVisible(album: ShareAlbumGuardRow) {
  if (album.is_public === false) return false

  if (
    album.status &&
    album.status !== 'active' &&
    album.status !== 'published' &&
    album.status !== 'public'
  ) {
    return false
  }

  return true
}

function getShareSecret() {
  // Reuses the service-role key purely as an HMAC signing secret. It is
  // server-only, never sent to the client, and rotates the same way the
  // rest of the backend's trust boundary does.
  return process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

export function getShareAuthCookieName(albumId: string) {
  const shortHash = crypto
    .createHash('sha256')
    .update(albumId)
    .digest('hex')
    .slice(0, 20)

  return `ciiya_share_auth_${shortHash}`
}

export function signShareAuthToken(albumId: string, passwordHash: string) {
  return crypto
    .createHmac('sha256', getShareSecret())
    .update(`${albumId}:${passwordHash}`)
    .digest('hex')
}

function verifyShareAuthToken(
  albumId: string,
  passwordHash: string,
  providedToken: string | undefined | null
) {
  if (!providedToken) return false

  const expected = signShareAuthToken(albumId, passwordHash)
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(providedToken)

  if (expectedBuffer.length !== providedBuffer.length) return false

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer)
}

/**
 * True when the album is not password protected, or the caller presented a
 * valid signed cookie proving they already passed the password check.
 * Fails closed: if protection is enabled but no password hash was ever
 * saved, access is denied rather than silently allowed.
 */
export function hasValidSharePasswordAccess(
  album: ShareAlbumGuardRow,
  cookieValue: string | undefined | null
) {
  if (!album.is_password_protected) return true
  if (!album.password_hash) return false

  return verifyShareAuthToken(album.id, album.password_hash, cookieValue)
}
