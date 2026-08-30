/*
 * A stable, anonymous per-browser id used to dedupe likes on the public share
 * page. It replaces the old IP + User-Agent key, which collides badly on
 * mobile networks: carriers put many subscribers behind one CGNAT address, and
 * same-model phones send near-identical User-Agents, so two different guests
 * could hash to the same "identity" and cancel each other's likes.
 *
 * A random id in localStorage instead gives each browser its own identity,
 * independent of network or device model — the standard model for anonymous
 * reactions. It never leaves the visitor's browser except attached to their
 * own like requests, and carries no personal data.
 */
const STORAGE_KEY = 'ciiya-guest-id'

export function getGuestId(): string {
  if (typeof window === 'undefined') return ''

  try {
    let id = window.localStorage.getItem(STORAGE_KEY)

    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random()
              .toString(36)
              .slice(2)}`
      window.localStorage.setItem(STORAGE_KEY, id)
    }

    return id
  } catch {
    // Private mode or storage disabled: fall back to a per-session id so a
    // like still works within this page load.
    return ''
  }
}
