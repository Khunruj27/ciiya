import { expect, test } from '@playwright/test'

const expectedOrigin = new URL(
  process.env.E2E_BASE_URL || 'http://127.0.0.1:3100'
).origin

test.describe('public and protected API contracts', () => {
  test('public liveness probe is healthy', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      status: 'ok',
      service: 'ciiya',
    })
  })

  test('owner APIs reject anonymous access', async ({ request }) => {
    const [albums, workerStats, adminUsers] = await Promise.all([
      request.get('/api/albums'),
      request.get('/api/worker/stats'),
      request.get('/api/admin/users'),
    ])

    expect(albums.status()).toBe(401)
    expect(workerStats.status()).toBe(401)
    expect(adminUsers.status()).toBe(401)
  })

  test('share APIs require a token', async ({ request }) => {
    const [photos, moments] = await Promise.all([
      request.get('/api/share/photos'),
      request.get('/api/share/moments'),
    ])

    expect(photos.status()).toBe(400)
    expect(moments.status()).toBe(400)
  })

  test('public share/download endpoints reject malformed requests', async ({
    request,
  }) => {
    const [verifyPassword, faceSearch, download] = await Promise.all([
      // Password check without a token — can't leak which album exists.
      request.post('/api/share/verify-password', { data: {} }),
      // Face search without album/token/descriptor.
      request.post('/api/faces/search', { data: {} }),
      // Download without a photo id or token.
      request.get('/api/photos/download'),
    ])

    expect(verifyPassword.status()).toBe(400)
    expect(faceSearch.status()).toBe(400)
    expect(download.status()).toBe(400)
  })

  test('browser error monitoring accepts same-origin reports and blocks cross-origin posts', async ({ request }) => {
    const accepted = await request.post('/api/monitoring/client-error', {
      headers: { Origin: expectedOrigin },
      data: {
        message: 'E2E monitoring contract check',
        name: 'SyntheticError',
        route: '/e2e',
      },
    })
    const blocked = await request.post('/api/monitoring/client-error', {
      headers: { Origin: 'https://example.com' },
      data: { message: 'Cross-origin report' },
    })

    expect(accepted.status()).toBe(202)
    expect(blocked.status()).toBe(403)
  })
})
