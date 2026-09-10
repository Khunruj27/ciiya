import { expect, test } from '@playwright/test'
import sharp from 'sharp'

const email = process.env.E2E_USER_EMAIL
const password = process.env.E2E_USER_PASSWORD

test.describe('authenticated owner core flow', () => {
  test.skip(({ isMobile }) => isMobile, 'run the mutating flow once on desktop')
  test.skip(!email || !password, 'set dedicated E2E_USER_EMAIL and E2E_USER_PASSWORD')

  test('login, create an album, upload, share and clean up', async ({ page, browser }) => {
    test.setTimeout(90_000)

    await page.goto('/login')
    await page.locator('#login-email').fill(email!)
    await page.locator('#login-password').fill(password!)
    await Promise.all([
      page.waitForURL(/\/albums(?:\/|$)/),
      page.locator('button[type="submit"]').click(),
    ])

    const created = await page.evaluate(async () => {
      const response = await fetch('/api/albums/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Ciiya E2E ${Date.now()}`,
          description: 'Temporary automated release check',
          uploadMode: 'manual',
          uploadSize: 'sd',
          uploadProfile: 'quick',
          autoPublish: true,
          autoFaceScan: false,
        }),
      })
      return { status: response.status, body: await response.json() }
    })

    expect(created.status).toBe(201)
    const albumId = String(created.body?.album?.id || '')
    const shareToken = String(created.body?.album?.share_token || '')
    expect(albumId).not.toBe('')
    expect(shareToken).not.toBe('')

    try {
      await page.goto(`/albums/${albumId}`)
      await page.getByRole('button', { name: /upload photos|upload photo|อัปโหลดรูป/i }).first().click()

      const jpeg = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 3,
          background: { r: 199, g: 168, b: 107 },
        },
      })
        .jpeg({ quality: 80 })
        .toBuffer()

      await page.locator('input[accept*="image/jpeg"]').setInputFiles({
        name: 'ciiya-e2e.jpg',
        mimeType: 'image/jpeg',
        buffer: jpeg,
      })

      const finalized = page.waitForResponse(
        (response) => response.url().includes('/api/photos/finalize-upload'),
        { timeout: 45_000 }
      )
      await page.getByRole('button', { name: /start upload|เริ่มอัปโหลด/i }).click()
      expect((await finalized).status()).toBeLessThan(300)

      const guestContext = await browser.newContext()
      const guestPage = await guestContext.newPage()
      const shared = await guestPage.goto(`/share/${shareToken}`)
      expect(shared?.status()).toBeLessThan(400)
      await expect(guestPage.getByText(created.body.album.title).first()).toBeVisible()
      await guestContext.close()
    } finally {
      const deleted = await page.evaluate(async (id) => {
        const response = await fetch('/api/albums/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ albumId: id }),
        })
        return response.status
      }, albumId)
      expect(deleted).toBe(200)
    }
  })
})
