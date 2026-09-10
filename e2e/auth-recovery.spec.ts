import { expect, test } from '@playwright/test'

test.describe('password recovery', () => {
  test('offers an email reset form without revealing account state', async ({ page }) => {
    await page.goto('/forgot-password')

    await expect(page).toHaveURL(/\/forgot-password/)
    await expect(page.locator('#recovery-email')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeEnabled()
  })

  test('requires a recovery session before choosing a new password', async ({ page }) => {
    await page.goto('/reset-password')

    await expect(page).toHaveURL(/\/forgot-password\?error=expired/)
    await expect(
      page.getByText(
        'ลิงก์ตั้งรหัสผ่านหมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่'
      )
    ).toBeVisible()
  })

  test('recovery callback errors return to the recovery page', async ({ page }) => {
    await page.goto('/auth/callback?next=/reset-password&error=expired')
    await expect(page).toHaveURL(/\/forgot-password\?error=expired/)
  })
})
