import { test, expect, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import type { SharedPhoto } from '../src/lib/share-photo-updates'

// Isolated browser regression: real gallery/poller/selection components, fake
// network. Never uploads, likes, or modifies a customer's production album.
let bundle: string
let css: string
const since = '2026-10-01T00:00:00.000Z'
const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const photo = (id: string, createdAt = since): SharedPhoto => ({
  id, album_id: 'fixture-album', filename: `${id}.jpg`, processing_status: 'done',
  public_url: pixel, preview_url: pixel, thumbnail_url: pixel,
  created_at: createdAt, updated_at: '2026-10-01T00:05:00.123456Z',
})

test.beforeAll(async () => {
  // Use the real stylesheet: partial utility stubs can falsely overlap the
  // lightbox controls and hide genuine interaction regressions.
  css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), {
    from: 'src/app/globals.css',
  })).css
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import Gallery from './src/components/public-gallery-infinite';
      import { I18nProvider } from './src/components/i18n-provider';
      const root = createRoot(document.getElementById('root'));
      window.renderGallery = (photos, cursor = null) => root.render(<I18nProvider locale="en"><Gallery
        initialPhotos={photos} totalCount={photos.length} albumId="fixture-album"
        albumTitle="Live fixture" shareToken="fixture-token" initialCursor={cursor}
        initialSyncSince="${since}" /></I18nProvider>);
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'native-image', setup(builder) {
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: `import React from 'react'; export default function Image({fill, unoptimized, priority, ...props}) {return <img {...props} />}`,
        loader: 'jsx', resolveDir: process.cwd(),
      }))
    } }],
  })
  bundle = result.outputFiles[0].text
})

async function mount(page: Page, initialPhotos: SharedPhoto[] = [], options: {
  cursor?: string
  setupRoutes?: () => Promise<void>
} = {}) {
  await page.route('**/__share_live_fixture', (route) => route.fulfill({ contentType: 'text/html', body: `
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${css}</style><div id="root"></div>` }))
  // Block all other API calls, including the gallery's view tracker.
  await page.route('**/api/**', (route) => route.fulfill({ json: { success: true } }))
  await options.setupRoutes?.()
  await page.goto('/__share_live_fixture')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(({ photos, cursor }) => {
    (window as unknown as { renderGallery: (photos: SharedPhoto[], cursor: string | null) => void }).renderGallery(photos, cursor)
  }, { photos: initialPhotos, cursor: options.cursor ?? null })
}

test('photo pagination retries the same boundary despite live inserts and deduplicates tied photos', async ({ page }) => {
  const cursor = JSON.stringify({ createdAt: '2026-10-01T00:00:00.123456Z', id: '00000000-0000-4000-8000-000000000002' })
  const boundary = photo('boundary', '2026-10-01T00:00:00.123456Z')
  const cursors: Array<string | null> = []
  let live: SharedPhoto[] = []
  await mount(page, [boundary], { cursor, setupRoutes: async () => {
    await page.route('**/api/share/photos?*', async (route) => {
      cursors.push(new URL(route.request().url()).searchParams.get('cursor'))
      if (cursors.length === 1) {
        await route.fulfill({ status: 503, json: { error: 'Temporary failure' } })
      } else {
        await route.fulfill({ json: { success: true, photos: [boundary, photo('tied', boundary.created_at)], hasMore: false, nextCursor: null } })
      }
    })
    await page.route('**/api/share/photos/updates?*', (route) => route.fulfill({ json: { success: true, photos: live, nextCursor: null } }))
  } })
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
  live = [photo('new-live', '2026-10-02T00:00:00Z')]
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('img[alt="new-live.jpg"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.locator('img[alt="tied.jpg"]')).toHaveCount(1)
  await expect(page.locator('img[alt="boundary.jpg"]')).toHaveCount(1)
  expect(cursors).toEqual([cursor, cursor])
})

test('photo pagination continues automatically through empty visible pages', async ({ page }) => {
  const cursors = [3, 2, 1].map((id) => JSON.stringify({
    createdAt: '2026-10-01T00:00:00.123456Z', id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  }))
  const requested: Array<string | null> = []
  await mount(page, [], { cursor: cursors[0], setupRoutes: async () => {
    await page.route('**/api/share/photos?*', async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor')
      requested.push(cursor)
      const next = cursors[cursors.indexOf(cursor ?? '') + 1] ?? null
      await route.fulfill({ json: {
        success: true, photos: next ? [] : [photo('older-ready')], hasMore: Boolean(next), nextCursor: next,
      } })
    })
  } })
  await expect(page.locator('img[alt="older-ready.jpg"]')).toHaveCount(1)
  expect(requested).toEqual(cursors)
  await expect(page.getByRole('button', { name: 'Load more photos', exact: true })).toHaveCount(0)
})

test('empty album receives first photo, delayed completion and pages without navigation', async ({ page }) => {
  await mount(page)
  let calls = 0
  const requests: URL[] = []
  let rows: SharedPhoto[] = []
  let nextCursor: object | null = null
  await page.route('**/api/share/photos/updates?*', async (route) => {
    calls++
    requests.push(new URL(route.request().url()))
    await route.fulfill({ json: { success: true, photos: rows, latestUpdatedAt: rows.at(-1)?.updated_at, nextCursor } })
    nextCursor = null
  })
  await expect(page.getByText(/no photos yet/i).first()).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => calls).toBeGreaterThan(0)
  rows = [photo('first')]
  // No page.reload(): this is the real five-second timer.
  await expect(page.locator('img[alt="first.jpg"]')).toHaveCount(1, { timeout: 12_000 })
  const oldUpload = photo('slow-worker', '2026-09-01T00:00:00Z')
  rows = [photo('first'), oldUpload, { ...photo('pending'), processing_status: 'processing' }]
  nextCursor = { updatedAt: oldUpload.updated_at, id: '11111111-1111-4111-8111-111111111111' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('img[alt="slow-worker.jpg"]')).toHaveCount(1)
  await expect.poll(() => requests.some((url) => url.searchParams.has('cursor'))).toBe(true)
  await expect(page.locator('img[alt="first.jpg"]')).toHaveCount(1)
  await expect(page.locator('img[alt="pending.jpg"]')).toHaveCount(0)
  expect(requests.every((url) => url.searchParams.get('token') === 'fixture-token')).toBe(true)
  expect(new URL(page.url()).pathname).toBe('/__share_live_fixture')
})

test('retries errors, resumes online, and clears the gallery when access is revoked', async ({ page, context }) => {
  await mount(page, [photo('existing')])
  let status = 500
  let calls = 0
  await page.route('**/api/share/photos/updates?*', async (route) => {
    calls++
    await route.fulfill({ status, json: { success: status === 200, photos: [photo('recovered')], nextCursor: null } })
  })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => calls).toBeGreaterThan(0)
  await expect(page.locator('img[alt="existing.jpg"]')).toHaveCount(1)
  status = 200
  await expect(page.locator('img[alt="recovered.jpg"]')).toHaveCount(1, { timeout: 12_000 })
  await context.setOffline(true)
  const offlineCalls = calls
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(calls).toBe(offlineCalls)
  await context.setOffline(false)
  await expect.poll(() => calls).toBeGreaterThan(offlineCalls)
  status = 401
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('alert')).toContainText('access has changed')
  await expect(page.locator('img')).toHaveCount(0)
})

test('incoming photos do not change the open lightbox or selected photo', async ({ page }) => {
  await mount(page, [photo('original')])
  let rows: SharedPhoto[] = []
  await page.route('**/api/share/photos/updates?*', (route) => route.fulfill({ json: { success: true, photos: rows, nextCursor: null } }))
  await page.locator('img[alt="original.jpg"]').click()
  const viewer = page.locator('[class*="z-[100]"] img')
  await expect(viewer).toHaveAttribute('alt', 'original.jpg')
  rows = [photo('newer', '2026-10-02T00:00:00Z')]
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('img[alt="newer.jpg"]')).toHaveCount(1)
  await expect(viewer).toHaveAttribute('alt', 'original.jpg')
  await page.getByRole('button', { name: '✕', exact: true }).click()
  await page.getByRole('button', { name: /select photos/i }).click()
  await page.locator('img[alt="original.jpg"]').click()
  await expect(page.getByText(/selected 1\/5 photos/)).toBeVisible()
  rows = [photo('newest', '2026-10-03T00:00:00Z')]
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('img[alt="newest.jpg"]')).toHaveCount(1)
  await expect(page.getByText(/selected 1\/5 photos/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Download/ })).toBeEnabled()
})

test('large albums mount only nearby rows and retain selection across page scrolling', async ({ page }) => {
  await page.route('**/api/share/photos/updates?*', (route) => route.fulfill({
    json: { success: true, photos: [], nextCursor: null },
  }))
  await mount(page, Array.from({ length: 1_000 }, (_, index) => photo(`large-${index}`)))
  const grid = page.locator('[data-page-windowed-grid]')
  const tiles = grid.locator('img')
  await expect(grid.locator('img[alt="large-0.jpg"]')).toBeVisible()
  await expect.poll(() => tiles.count()).toBeLessThan(120)
  await page.getByRole('button', { name: /select photos/i }).click()
  await grid.locator('img[alt="large-0.jpg"]').click()
  await expect(page.getByText(/selected 1\/5 photos/)).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(grid.locator('img[alt="large-999.jpg"]')).toBeVisible()
  await expect(grid.locator('img[alt="large-0.jpg"]')).toHaveCount(0)
  await expect.poll(() => tiles.count()).toBeLessThan(120)
  await expect(page.getByText(/selected 1\/5 photos/)).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(grid.locator('img[alt="large-0.jpg"]')).toBeVisible()
  await expect(grid.locator('button').filter({ has: page.locator('img[alt="large-0.jpg"]') })
    .locator('.border-gold.bg-gold')).toHaveCount(1)
})

test('existing shared album uses the real token-gated update endpoint', async ({ page }) => {
  const token = process.env.E2E_SHARE_TOKEN
  test.skip(!token, 'Set E2E_SHARE_TOKEN for the read-only integration smoke test')
  await page.route('**/api/share/view', (route) => route.fulfill({ json: { success: true } }))
  const update = page.waitForResponse((response) => response.url().includes('/api/share/photos/updates?'))
  await page.goto(`/share/${token}`)
  const response = await update
  expect(response.status()).toBe(200)
  const data = await response.json()
  expect(data.success).toBe(true)
  expect(data.photos.every((p: SharedPhoto) => p.processing_status === 'done' && p.preview_url && p.thumbnail_url)).toBe(true)
  const gallery = page.locator('#shared-gallery')
  await expect(gallery.locator('img').first()).toBeVisible()
})
