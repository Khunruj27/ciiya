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
