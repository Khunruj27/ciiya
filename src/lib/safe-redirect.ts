export const DEFAULT_POST_LOGIN_REDIRECT = '/albums'

/*
 * `next` reaches the auth callback through a URL the visitor can edit, so it
 * is only ever allowed to be a path on this site. Anything absolute
 * ("https://evil.com") or protocol-relative ("//evil.com") would otherwise
 * turn the callback into an open redirect that borrows this domain's trust —
 * the classic phishing shape for a login flow.
 *
 * Backslashes are rejected too: some browsers normalise "/\evil.com" to
 * "//evil.com" after this check would have passed it.
 */
export function getSafeRedirectPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_POST_LOGIN_REDIRECT
) {
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value.includes('\\')) return fallback
  return value
}
