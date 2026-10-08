import { expect, test } from '@playwright/test'
import { readBearerAccessToken } from '../src/lib/bearer-token'

/**
 * The mobile app authenticates API calls with the signed-in user's Supabase
 * access token as `Authorization: Bearer <jwt>`. These checks pin the two
 * properties that keep that safe: only JWT-shaped credentials are treated as a
 * user token, and an unverifiable token is rejected exactly like no session.
 */
test.describe('bearer access-token parsing', () => {
  test('accepts only a JWT-shaped Bearer credential', () => {
    expect(readBearerAccessToken('Bearer aaa.bbb.ccc')).toBe('aaa.bbb.ccc')
    expect(readBearerAccessToken('  Bearer   aaa.bbb.ccc  ')).toBe('aaa.bbb.ccc')
    expect(readBearerAccessToken('Bearer a-b_c.d-e_f.g-h_i')).toBe(
      'a-b_c.d-e_f.g-h_i'
    )
  })

  test('ignores missing, malformed and non-user credentials', () => {
    expect(readBearerAccessToken(null)).toBeNull()
    expect(readBearerAccessToken(undefined)).toBeNull()
    expect(readBearerAccessToken('')).toBeNull()
    expect(readBearerAccessToken('aaa.bbb.ccc')).toBeNull()
    expect(readBearerAccessToken('Basic aaa.bbb.ccc')).toBeNull()
    expect(readBearerAccessToken('Bearer aaa.bbb')).toBeNull()
    expect(readBearerAccessToken('Bearer aaa.bbb.ccc.ddd')).toBeNull()
    expect(readBearerAccessToken('Bearer aaa.bbb.ccc extra')).toBeNull()
    expect(readBearerAccessToken('Bearer aaa.b b.ccc')).toBeNull()
    // A Ciiya Sync device token must never be mistaken for a user session.
    expect(
      readBearerAccessToken(`Bearer ciiya_sync_${'A'.repeat(43)}`)
    ).toBeNull()
  })
})

test.describe('owner APIs with a bearer credential', () => {
  test('reject a forged access token like an anonymous request', async ({
    request,
  }) => {
    const forged = { Authorization: 'Bearer aaaa.bbbb.cccc' }
    const [albums, create] = await Promise.all([
      request.get('/api/albums', { headers: forged }),
      request.post('/api/albums/create', {
        headers: forged,
        data: { title: 'Should never be created' },
      }),
    ])

    expect(albums.status()).toBe(401)
    expect(create.status()).toBe(401)
  })

  test('do not treat a device-token-shaped credential as a user', async ({
    request,
  }) => {
    const response = await request.get('/api/albums', {
      headers: { Authorization: `Bearer ciiya_sync_${'A'.repeat(43)}` },
    })

    expect(response.status()).toBe(401)
  })
})

test.describe('mobile read APIs', () => {
  const albumId = '00000000-0000-4000-8000-000000000000'
  const paths = [
    '/api/mobile/albums',
    `/api/mobile/albums/${albumId}`,
    `/api/mobile/albums/${albumId}/photos`,
  ]

  for (const path of paths) {
    test(`${path} requires a signed-in owner`, async ({ request }) => {
      const [anonymous, forged] = await Promise.all([
        request.get(path),
        request.get(path, {
          headers: { Authorization: 'Bearer aaaa.bbbb.cccc' },
        }),
      ])

      expect(anonymous.status()).toBe(401)
      expect(forged.status()).toBe(401)
    })
  }
})
