import { expect, test } from '@playwright/test'

test.describe('mobile layout and touch targets', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile project only')

  for (const path of ['/', '/login', '/signup', '/forgot-password']) {
    test(`${path} fits the viewport and exposes comfortable controls`, async ({ page }) => {
      await page.goto(path)

      const audit = await page.evaluate(() => {
        const overflow =
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        const controls = Array.from(document.querySelectorAll<HTMLElement>('a, button'))
          .filter((element) => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
          })
          .map((element) => {
            const rect = element.getBoundingClientRect()
            return {
              label: (element.getAttribute('aria-label') || element.textContent || '').trim(),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          })
        return {
          overflow,
          undersized: controls.filter((control) => control.width < 44 || control.height < 44),
        }
      })

      expect(audit.overflow).toBe(false)
      expect(audit.undersized).toEqual([])
    })
  }
})
