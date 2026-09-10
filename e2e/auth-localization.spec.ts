import { expect, test } from '@playwright/test'

test.describe('localized authentication errors', () => {
  test('login replaces Supabase credential errors with Thai customer copy', async ({
    page,
  }) => {
    await page.route('**/auth/v1/token?grant_type=password', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'invalid_credentials',
          message: 'Invalid login credentials',
        }),
      })
    })

    await page.goto('/login')
    await page.locator('#login-email').fill('visitor@example.com')
    await page.locator('#login-password').fill('incorrect-password')
    await page.locator('form button[type="submit"]').click()

    const alert = page.locator('p[role="alert"]')
    await expect(alert).toContainText(
      'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่'
    )
    await expect(alert).not.toContainText('Invalid login credentials')
  })

  test('signup replaces Supabase account errors with Thai customer copy', async ({
    page,
  }) => {
    await page.route('**/auth/v1/signup**', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'user_already_exists',
          message: 'User already registered',
        }),
      })
    })

    await page.goto('/signup')
    await page.locator('#signup-email').fill('member@example.com')
    await page.locator('#signup-password').fill('valid-password')
    await page.locator('#signup-confirm-password').fill('valid-password')
    await page.locator('form button[type="submit"]').click()

    const alert = page.locator('p[role="alert"]')
    await expect(alert).toContainText(
      'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบหรือรีเซ็ตรหัสผ่าน'
    )
    await expect(alert).not.toContainText('User already registered')
  })

  test('OAuth callbacks never echo provider error descriptions', async ({ page }) => {
    await page.goto(
      '/auth/callback?error=access_denied&error_description=Raw+provider+failure'
    )

    await expect(page).toHaveURL(/\/login\?error=oauth_failed/)
    const alert = page.locator('p[role="alert"]')
    await expect(alert).toContainText(
      'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
    )
    await expect(alert).not.toContainText('Raw provider failure')
  })
})
