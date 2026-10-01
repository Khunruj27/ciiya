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
      window.renderGallery = (photos) => root.render(<I18nProvider locale="en"><Gallery
        initialPhotos={photos} totalCount={photos.length} albumId="fixture-album"
        albumTitle="Live fixture" shareToken="fixture-token" initialCursor={null}
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

async function mount(page: Page, initialPhotos: SharedPhoto[] = []) {
  await page.route('**/__share_live_fixture', (route) => route.fulfill({ contentType: 'text/html', body: `
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${css}</style><div id="root"></div>` }))
  // Block all other API calls, including the gallery's view tracker.
  await page.route('**/api/**', (route) => route.fulfill({ json: { success: true } }))
  await page.goto('/__share_live_fixture')
  await page.addScriptTag({ content: bundle })
  await page.evaluate((photos) => {
    (window as unknown as { renderGallery: (photos: SharedPhoto[]) => void }).renderGallery(photos)
  }, initialPhotos)
}

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
