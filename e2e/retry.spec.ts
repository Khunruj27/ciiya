import { expect, test } from '@playwright/test'
import { retryAsync } from '../src/lib/retry'

test.describe('retry helper', () => {
  test('retries a rejected transient operation and returns the result', async () => {
    let attempts = 0

    const result = await retryAsync(
      async () => {
        attempts += 1
        if (attempts < 3) throw new Error('network timeout')
        return 'ready'
      },
      { attempts: 3, delayMs: 0 }
    )

    expect(result).toBe('ready')
    expect(attempts).toBe(3)
  })

  test('retries a resolved service response that carries an error', async () => {
    let attempts = 0

    const result = await retryAsync(
      async () => {
        attempts += 1
        return attempts < 3
          ? { value: '', error: new Error('service unavailable') }
          : { value: 'uploaded', error: null }
      },
      {
        attempts: 3,
        delayMs: 0,
        getRetryableResultError: (response) => response.error,
      }
    )

    expect(result.value).toBe('uploaded')
    expect(attempts).toBe(3)
  })

  test('does not retry an explicitly non-retryable failure', async () => {
    let attempts = 0

    await expect(
      retryAsync(
        async () => {
          attempts += 1
          throw new Error('invalid request')
        },
        {
          attempts: 3,
          delayMs: 0,
          shouldRetryError: () => false,
        }
      )
    ).rejects.toThrow('invalid request')

    expect(attempts).toBe(1)
  })
})
