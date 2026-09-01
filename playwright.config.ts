import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config for Ciiya's core flows.
 *
 * - Local (default): starts `npm run dev` and tests http://localhost:3000.
 * - Against a deployment: set E2E_BASE_URL=https://ciiya.vercel.app and the
 *   local dev server is not started.
 *
 * Some specs need seed data supplied via env (e.g. E2E_SHARE_TOKEN for the
 * public share flow); those specs skip themselves when the value is absent so
 * the suite stays green in a bare checkout.
 */
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000'
const useLocalServer = !process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: useLocalServer
    ? {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
})
