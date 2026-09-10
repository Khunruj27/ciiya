export type RetryOptions<T> = {
  attempts?: number
  delayMs?: number
  getRetryableResultError?: (result: T) => Error | null
  shouldRetryError?: (error: unknown) => boolean
}

function wait(ms: number) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

/**
 * Retries rejected promises and, when requested, service responses that carry
 * an error without rejecting (Supabase clients commonly use that shape).
 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  {
    attempts = 3,
    delayMs = 1000,
    getRetryableResultError,
    shouldRetryError = () => true,
  }: RetryOptions<T> = {}
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(attempts))
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation()
      const resultError = getRetryableResultError?.(result) || null

      if (resultError) throw resultError
      return result
    } catch (error) {
      lastError = error

      if (attempt >= maxAttempts || !shouldRetryError(error)) {
        throw error
      }

      await wait(delayMs * attempt)
    }
  }

  throw lastError
}
