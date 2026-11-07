// A Supabase access token is a JWT: three base64url segments. Ciiya Sync device
// tokens (`ciiya_sync_…`) and any other credential never match, so they keep
// being handled by their own authenticators and are never treated as a user.
const BEARER_ACCESS_TOKEN_PATTERN =
  /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

/**
 * Extracts a Supabase access token from an `Authorization: Bearer <jwt>`
 * header, or returns null when the header is absent or carries anything else.
 * Shape only — the token is verified later by `supabase.auth.getUser()`.
 */
export function readBearerAccessToken(
  authorization: string | null | undefined
): string | null {
  const match = BEARER_ACCESS_TOKEN_PATTERN.exec(
    String(authorization || '').trim()
  )
  return match ? match[1] : null
}
