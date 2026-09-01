import { test, expect } from '@playwright/test'

/**
 * Core public navigation — the flow every visitor hits before signing in.
 * Selectors avoid localized copy (they key off routes, roles, and the Google
 * brand name) so the suite survives the Thai/English language switch.
 */

test.describe('landing → auth entry', () => {
  test('landing renders and offers sign up / sign in', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBeLessThan(400)

    await expect(page.locator('h1').first()).toBeVisible()
    await expect(page.locator('a[href="/signup"]').first()).toBeVisible()
    await expect(page.locator('a[href="/login"]').first()).toBeVisible()
  })

  test('login page exposes Google sign-in', async ({ page }) => {
    await page.goto('/login')
    // The Google button is the primary auth path; brand text is language-neutral.
    await expect(page.getByText(/Google/i).first()).toBeVisible()
  })

  test('signup page loads', async ({ page }) => {
    const response = await page.goto('/signup')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByText(/Google/i).first()).toBeVisible()
  })

  test('pricing page loads', async ({ page }) => {
    const response = await page.goto('/pricing')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('protected routes redirect to login', () => {
  for (const path of ['/albums', '/me', '/portfolio', '/notifications']) {
    test(`${path} redirects an anonymous visitor to /login`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
    })
  }
})
