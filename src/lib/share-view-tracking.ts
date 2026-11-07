// Shared duration only; this module contains no credentials or database code.
export const VIEW_WINDOW_MS = 6 * 60 * 60 * 1000

const confirmed = new Map<string, number>()
const inFlight = new Map<string, Promise<void>>()
const retryDelays = [500, 1500]

function alreadyConfirmed(token: string) {
  const now = Date.now()
  if ((confirmed.get(token) || 0) > now) return true
  confirmed.delete(token)
  try {
    const expiresAt = Number(window.sessionStorage.getItem(`ciiya_viewed_${token}`))
    // Legacy "true" markers were written before the API responded. They are
    // not evidence that a view committed, and must not suppress new attempts.
    if (expiresAt > now && expiresAt <= now + VIEW_WINDOW_MS) {
      confirmed.set(token, expiresAt)
      return true
    }
  } catch {
    // Storage can be blocked in private browsers; tracking must still run.
  }
  return false
}

async function sendView(token: string) {
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (!navigator.onLine) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch('/api/share/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'same-origin',
        signal: controller.signal,
        keepalive: true,
      })
      const result = await response.json().catch(() => null)
      if (response.ok && result?.success === true &&
        (result.counted === true || result.mode === 'cookie-skip')) {
        const now = Date.now()
        const expiresAt = result.view_expires_at === undefined
          ? now + VIEW_WINDOW_MS : Number(result.view_expires_at)
        // An explicitly expired server window must not be extended six hours
        // just because its response arrived late. Missing fields alone retain
        // compatibility with older deployments.
        if (!(expiresAt > now && expiresAt <= now + VIEW_WINDOW_MS)) return
        confirmed.set(token, expiresAt)
        try {
          window.sessionStorage.setItem(`ciiya_viewed_${token}`, String(expiresAt))
        } catch {
          // The in-memory marker and server cookie still prevent repeats.
        }
        return
      }
      // Only retry when the server confirms that no mutation committed, or
      // throttles before mutation. A generic 5xx can hide a committed write.
      if (response.status !== 429 && !(response.status >= 500 && result?.retryable === true)) return
    } catch {
      // Network/timeout outcomes are ambiguous: do not immediately resubmit a
      // possibly committed increment. No marker is saved; a later online/focus
      // event can try again, with the server cookie if it reached the browser.
      return
    } finally {
      clearTimeout(timeout)
    }
    if (attempt < retryDelays.length) {
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]))
    }
  }
}

export function trackShareView(token: string): Promise<void> {
  if (!token || typeof window === 'undefined' || alreadyConfirmed(token)) {
    return Promise.resolve()
  }
  const existing = inFlight.get(token)
  if (existing) return existing

  // Coalesce StrictMode effects, remounts, and online/focus events. Keepalive
  // is intentionally not cancelled on unmount: the visitor already saw this
  // gallery, and a cancelled response could lose its deduplication cookie.
  const pending = sendView(token).finally(() => inFlight.delete(token))
  inFlight.set(token, pending)
  return pending
}
