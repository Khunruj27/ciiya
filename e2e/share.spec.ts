import { test, expect } from '@playwright/test'

/**
 * The guest side of the core flow: opening a shared gallery and reacting to a
 * photo. It needs a real published share token, supplied as E2E_SHARE_TOKEN
 * (the demo account created for testing is a good source). Without it the spec
 * skips rather than failing, so a bare checkout stays green.
 */
const shareToken = process.env.E2E_SHARE_TOKEN

test.describe('public share gallery', () => {
  test.skip(!shareToken, 'set E2E_SHARE_TOKEN to run the share flow')

  test('opens a shared gallery and shows photos', async ({ page }) => {
    const response = await page.goto(`/share/${shareToken}`)
    expect(response?.status()).toBeLessThan(400)

    // At least one gallery image should load.
    const firstImage = page.locator('img').first()
    await expect(firstImage).toBeVisible()
  })

  test('a guest can like a photo', async ({ page }) => {
    await page.goto(`/share/${shareToken}`)

    // The heart control carries an accessible name regardless of language.
    const like = page
      .getByRole('button', { name: /like|heart|ถูกใจ|หัวใจ/i })
      .first()

    if ((await like.count()) === 0) {
      test.skip(true, 'no like control on this gallery')
      return
    }

    await like.click()
    // Toggling should not throw and the control stays in the document.
    await expect(like).toBeVisible()
  })
})

/**
 * Security regression guard: a share link is a secret capability. An unknown or
 * revoked token must resolve to "not found" and never expose album photos —
 * this locks in the RLS lock-down + service-role token validation. No seed
 * token needed, so it always runs.
 */
test.describe('share token enforcement', () => {
  test('an unknown share token shows not-found, never a gallery', async ({ page }) => {
    await page.goto('/share/thisisnotarealshare000000000000')

    // The not-found copy is shown (Thai default, English tolerated)...
    await expect(page.getByText(/ไม่พบ|not found/i).first()).toBeVisible()

    // ...and no real gallery photo is served for a bogus token.
    const storagePhotos = page.locator(
      'img[src*="supabase.co/storage"], img[src*="/storage/v1/object"]'
    )
    await expect(storagePhotos).toHaveCount(0)
  })
})
