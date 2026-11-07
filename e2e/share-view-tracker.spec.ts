import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'

// Real tracker + React development StrictMode, with every request intercepted.
// These tests never depend on credentials or modify a production album.
let bundle: string
const fixturePath = '/__share_view_fixture'
const token = 'fixture-share-token'
const windowMs = 6 * 60 * 60 * 1_000
const storageKey = (value = token) => `ciiya_viewed_${value}`

type FixtureWindow = Window & {
  renderTracker: (token: string, mountKey?: number) => void
}

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import React, { StrictMode } from 'react';
        import { createRoot } from 'react-dom/client';
        import Tracker from './src/components/share-view-tracker';
        const root = createRoot(document.getElementById('root'));
        window.renderTracker = (token, mountKey = 0) => root.render(
          <StrictMode><Tracker key={mountKey} token={token} /></StrictMode>
        );
      `,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    // Production React does not replay effects, so keep this fixture in dev.
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  bundle = result.outputFiles[0].text
})

test.beforeEach(async ({ page }) => {
  await page.route(`**${fixturePath}`, (route) => route.fulfill({
    contentType: 'text/html',
    body: '<meta name="viewport" content="width=device-width, initial-scale=1" /><div id="root"></div>',
  }))
  // A typo in an API path must not escape to a real server/database.
  await page.route('**/api/**', (route) => route.fulfill({
    status: 404,
    json: { success: false },
  }))
})

async function load(page: Page, value = token) {
  await page.goto(fixturePath)
  await page.addScriptTag({ content: bundle })
  await render(page, value)
}

async function render(page: Page, value = token, mountKey = 0) {
  await page.evaluate(({ value, mountKey }) => {
    (window as unknown as FixtureWindow).renderTracker(value, mountKey)
  }, { value, mountKey })
}

async function wake(page: Page, event: 'focus' | 'online' = 'focus') {
  await page.evaluate((name) => window.dispatchEvent(new Event(name)), event)
}

async function marker(page: Page, value = token) {
  return page.evaluate((key) => sessionStorage.getItem(key), storageKey(value))
}

async function expectConfirmed(page: Page, value = token) {
  await expect.poll(async () => Number(await marker(page, value))).toBeGreaterThan(Date.now())
}

test('confirmed views deduplicate focus, online, remount and document reload', async ({ page }) => {
  let calls = 0
  await page.route('**/api/share/view', (route) => {
    calls++
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({ token })
    return route.fulfill({ json: { success: true, counted: true, mode: 'rpc' } })
  })
  const before = Date.now()
  await load(page)
  await expectConfirmed(page)
  const expiry = Number(await marker(page))
  expect(expiry).toBeGreaterThanOrEqual(before + windowMs)
  expect(expiry).toBeLessThanOrEqual(Date.now() + windowMs)
  await wake(page)
  await wake(page, 'online')
  await render(page, token, 1)
  await load(page)
  await wake(page)
  expect(calls).toBe(1)
})

test('StrictMode, remount and overlapping wake events share one in-flight request', async ({ page }) => {
  let calls = 0
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/share/view', async (route) => {
    calls++
    await pending
    await route.fulfill({ json: { success: true, counted: true } })
  })
  await load(page)
  await expect.poll(() => calls).toBe(1)
  expect(await marker(page)).toBeNull()
  await wake(page)
  await wake(page, 'online')
  await render(page, token, 1)
  // Give React's remount effects a turn while the network response is held.
  await page.waitForTimeout(100)
  expect(calls).toBe(1)
  release!()
  await expectConfirmed(page)
  expect(calls).toBe(1)
})

test('transient 500 and 429 responses retry without caching until confirmed', async ({ page }) => {
  let calls = 0
  await page.route('**/api/share/view', (route) => {
    calls++
    return route.fulfill({
      status: calls === 1 ? 500 : calls === 2 ? 429 : 200,
      json: calls < 3 ? { success: false, retryable: true } : { success: true, counted: true },
    })
  })
  await load(page)
  await expect.poll(() => calls).toBe(1)
  expect(await marker(page)).toBeNull()
  await expectConfirmed(page)
  expect(calls).toBe(3)
})

test('three exhausted attempts leave no marker and recover on focus', async ({ page }) => {
  let calls = 0
  let healthy = false
  await page.route('**/api/share/view', (route) => {
    calls++
    return route.fulfill({
      status: healthy ? 200 : 503,
      json: { success: healthy, counted: healthy, retryable: !healthy },
    })
  })
  await load(page)
  await expect.poll(() => calls).toBe(3)
  await page.waitForTimeout(100)
  expect(await marker(page)).toBeNull()
  healthy = true
  await wake(page)
  await expectConfirmed(page)
  expect(calls).toBe(4)
})

test('ambiguous network failure does not retry immediately but recovers on focus', async ({ page }) => {
  let calls = 0
  await page.route('**/api/share/view', (route) => {
    calls++
    return calls === 1
      ? route.abort('failed')
      : route.fulfill({ json: { success: true, counted: true } })
  })
  await load(page)
  await expect.poll(() => calls).toBe(1)
  await page.waitForTimeout(2_200)
  expect(calls).toBe(1)
  expect(await marker(page)).toBeNull()
  await wake(page)
  await expectConfirmed(page)
  expect(calls).toBe(2)
})

for (const status of [400, 401, 404, 500]) {
  test(`HTTP ${status} does not retry or suppress a later authorized view`, async ({ page }) => {
    let calls = 0
    let allowed = false
    await page.route('**/api/share/view', (route) => {
      calls++
      return route.fulfill({
        status: allowed ? 200 : status,
        json: { success: allowed, counted: allowed },
      })
    })
    await load(page)
    await expect.poll(() => calls).toBe(1)
    await page.waitForTimeout(2_200)
    expect(calls).toBe(1)
    expect(await marker(page)).toBeNull()
    allowed = true
    await wake(page, 'online')
    await expectConfirmed(page)
    expect(calls).toBe(2)
  })
}

test('ambiguous keepalive timeout does not retry until a later focus', async ({ page }) => {
  await page.clock.install()
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    const fixture = window as unknown as Window & { trackerFetches: number; trackerTimeouts: number }
    fixture.trackerFetches = 0
    fixture.trackerTimeouts = 0
    window.fetch = (input, init) => {
      if (input === '/api/share/view') {
        fixture.trackerFetches++
        if (fixture.trackerFetches === 1) {
          // Model a request with an unknown server outcome: only abort tells
          // the browser it failed. Never contact a real API for this request.
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              fixture.trackerTimeouts++
              reject(new DOMException('Timed out', 'AbortError'))
            }, { once: true })
          })
        }
      }
      return originalFetch(input, init)
    }
  })
  let completedRequests = 0
  await page.route('**/api/share/view', (route) => {
    completedRequests++
    return route.fulfill({ json: { success: true, counted: true } })
  })
  const fetches = () => page.evaluate(() =>
    (window as unknown as Window & { trackerFetches: number }).trackerFetches)
  await load(page)
  await expect.poll(fetches).toBe(1)
  await page.clock.fastForward(8_100)
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as Window & { trackerTimeouts: number }).trackerTimeouts)).toBe(1)
  await page.clock.fastForward(3_000)
  expect(await fetches()).toBe(1)
  expect(completedRequests).toBe(0)
  expect(await marker(page)).toBeNull()
  await wake(page)
  await expectConfirmed(page)
  expect(await fetches()).toBe(2)
  expect(completedRequests).toBe(1)
})

test('storage blocked by browser privacy settings still tracks and deduplicates in memory', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('Storage disabled', 'SecurityError') },
    })
  })
  let calls = 0
  await page.route('**/api/share/view', (route) => {
    calls++
    return route.fulfill({ json: { success: true, counted: true } })
  })
  await load(page)
  await expect.poll(() => calls).toBe(1)
  // Allow the response to settle before testing the in-memory success cache.
  await page.waitForTimeout(100)
  await wake(page)
  await wake(page, 'online')
  await render(page, token, 1)
  await page.waitForTimeout(100)
  expect(calls).toBe(1)
})

test('changing the share token tracks the new album once', async ({ page }) => {
  const tokens: string[] = []
  await page.route('**/api/share/view', (route) => {
    tokens.push(route.request().postDataJSON().token)
    return route.fulfill({ json: { success: true, counted: true } })
  })
  await load(page)
  await expectConfirmed(page)
  await render(page, 'another-fixture-token')
  await expectConfirmed(page, 'another-fixture-token')
  await wake(page)
  await render(page, token)
  await page.waitForTimeout(100)
  expect(tokens).toEqual([token, 'another-fixture-token'])
})

for (const value of ['true', 'expired']) {
  test(`${value} legacy/session marker cannot suppress a legitimate new view`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => {
      sessionStorage.setItem(key, value === 'expired' ? String(Date.now() - 1_000) : value)
    }, { key: storageKey(), value })
    let calls = 0
    await page.route('**/api/share/view', (route) => {
      calls++
      return route.fulfill({ json: { success: true, counted: true } })
    })
    await load(page)
    await expectConfirmed(page)
    expect(calls).toBe(1)
  })
}

test('cookie-skip response is confirmed and prevents redundant requests', async ({ page }) => {
  let calls = 0
  await page.route('**/api/share/view', (route) => {
    calls++
    return route.fulfill({ json: { success: true, counted: false, mode: 'cookie-skip' } })
  })
  await load(page)
  await expectConfirmed(page)
  await wake(page)
  await render(page, token, 1)
  await page.waitForTimeout(100)
  expect(calls).toBe(1)
})

test('cookie-skip preserves the server expiry rather than starting a new six-hour window', async ({ page }) => {
  await page.clock.install()
  let calls = 0
  let serverExpiry: number | undefined
  await page.route('**/api/share/view', (route) => {
    calls++
    return route.fulfill({ json: { success: true, counted: false, mode: 'cookie-skip', view_expires_at: serverExpiry } })
  })
  // Create a nearly expired server window using the browser's own clock.
  await page.goto(fixturePath)
  serverExpiry = await page.evaluate(() => Date.now() + 5_000)
  await page.addScriptTag({ content: bundle })
  await render(page)
  await expect.poll(() => marker(page)).toBe(String(serverExpiry))
  expect(Number(await marker(page))).toBeLessThan(Date.now() + 60_000)
  await wake(page)
  expect(calls).toBe(1)
  await page.clock.fastForward(5_100)
  // The next server response represents a genuinely new six-hour window.
  serverExpiry = await page.evaluate(() => Date.now() + 6 * 60 * 60 * 1_000)
  await wake(page)
  await expect.poll(() => calls).toBe(2)
  await expect.poll(() => marker(page)).toBe(String(serverExpiry))
})

test('an expired server expiry does not create a fresh six-hour marker', async ({ page }) => {
  let calls = 0
  let renewed = false
  await page.route('**/api/share/view', (route) => {
    calls++
    return route.fulfill({ json: renewed
      ? { success: true, counted: true, mode: 'rpc', view_expires_at: Date.now() + windowMs }
      : { success: true, counted: false, mode: 'cookie-skip', view_expires_at: Date.now() - 1_000 } })
  })
  await load(page)
  await expect.poll(() => calls).toBe(1)
  await page.waitForTimeout(100)
  expect(await marker(page)).toBeNull()
  renewed = true
  await wake(page)
  await expectConfirmed(page)
  expect(calls).toBe(2)
})

test('an unconfirmed success payload is not cached and a later focus can recover', async ({ page }) => {
  let calls = 0
  let confirmed = false
  await page.route('**/api/share/view', (route) => {
    calls++
    return route.fulfill({ json: confirmed
      ? { success: true, counted: true }
      : { success: true, counted: false, mode: 'ignored' } })
  })
  await load(page)
  await expect.poll(() => calls).toBeGreaterThan(0)
  // The implementation may retry an unconfirmed 200; allow its bounded cycle.
  await page.waitForTimeout(2_300)
  expect(await marker(page)).toBeNull()
  const failedCalls = calls
  confirmed = true
  await wake(page)
  await expectConfirmed(page)
  expect(calls).toBe(failedCalls + 1)
})

test('the six-hour window expires in memory as well as session storage', async ({ page }) => {
  await page.clock.install()
  let calls = 0
  await page.route('**/api/share/view', (route) => {
    calls++
    return route.fulfill({ json: { success: true, counted: true } })
  })
  await load(page)
  await expectConfirmed(page)
  const previousExpiry = Number(await marker(page))
  await page.clock.fastForward(windowMs + 1_000)
  await wake(page)
  await expect.poll(() => calls).toBe(2)
  await expect.poll(async () => Number(await marker(page))).toBeGreaterThan(previousExpiry)
})
