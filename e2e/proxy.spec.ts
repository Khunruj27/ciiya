import { expect, test } from '@playwright/test'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import nextConfig from '../next.config'
import { config as proxyConfig } from '../src/proxy'

function matches(path: string) {
  return unstable_doesMiddlewareMatch({
    config: proxyConfig,
    nextConfig,
    url: `https://ciiya.test${path}`,
  })
}

test.describe('session proxy scope', () => {
  test('refreshes authenticated application pages', () => {
    expect(matches('/albums')).toBe(true)
    expect(matches('/albums/album-id')).toBe(true)
    expect(matches('/me')).toBe(true)
    expect(matches('/notifications')).toBe(true)
    expect(matches('/portfolio')).toBe(true)
    expect(matches('/admin/queue')).toBe(true)
  })

  test('does not intercept public or upload routes', () => {
    expect(matches('/')).toBe(false)
    expect(matches('/login')).toBe(false)
    expect(matches('/portfolio/public-studio')).toBe(false)
    expect(matches('/share/public-token')).toBe(false)
    expect(matches('/api/share/moments')).toBe(false)
    expect(matches('/api/photos/finalize-upload')).toBe(false)
  })
})
