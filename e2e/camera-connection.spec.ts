import { test, expect } from '@playwright/test'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

let bundle = ''
let css = ''
test.beforeAll(async () => {
  css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), {
    from: 'src/app/globals.css',
  })).css
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
        import Camera from './src/components/album-camera-status';
        import { I18nProvider } from './src/components/i18n-provider';
        const params = new URLSearchParams(location.search);
        createRoot(document.getElementById('root')).render(<I18nProvider locale={params.get('locale') === 'en' ? 'en' : 'th'}>
          <Camera albumId="fixture-album" albumTitle="Wedding Fixture" localUsbEnabled={params.has('local')} />
        </I18nProvider>);`,
      resolveDir: process.cwd(), loader: 'tsx',
    },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'camera-link', setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: `import React from 'react'; export default function Link(props) { return <a {...props} />; }`,
        loader: 'jsx', resolveDir: process.cwd(),
      }))
    } }],
  })
  bundle = result.outputFiles[0].text
})

for (const locale of ['th', 'en'] as const) {
  test(`hosted camera setup uses Ciiya Sync without USB polling (${locale})`, async ({ page }, testInfo) => {
    const requests: string[] = []
    await page.clock.install()
    await page.route('**/api/**', (route) => {
      requests.push(route.request().url())
      return route.fulfill({ status: 500, json: { error: 'Camera API should not be called by hosted setup' } })
    })
    await page.route('**/__camera_fixture*', (route) => route.fulfill({
      contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1" />
        <style>${css}</style><main class="mx-auto max-w-[720px] p-4"><div id="root"></div></main><script>${bundle}</script>`,
    }))
    await page.route('**/me/ciiya-sync', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Ciiya Sync setup fixture</h1>' }))
    await page.goto(`/__camera_fixture?locale=${locale}`)
    const heading = locale === 'th' ? 'รับรูปจากกล้องด้วย Ciiya Sync' : 'Import camera photos with Ciiya Sync'
    const action = locale === 'th' ? 'ตั้งค่า Ciiya Sync' : 'Set up Ciiya Sync'
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(page.getByRole('link', { name: action })).toHaveAttribute('href', '/me/ciiya-sync')
    await page.getByText(locale === 'th' ? 'วิธีรับรูปจากกล้องเข้าอัลบั้ม' : 'How to import camera photos into this album', { exact: true }).click()
    await expect(page.getByText(/Wedding Fixture/)).toBeVisible()
    await expect(page.getByText(/Start Live Folder|กดเริ่ม Live Folder/)).toBeVisible()
    await expect(page.getByText(/Export To/)).toBeVisible()
    await page.clock.runFor(60_000)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.clock.runFor(20_000)
    expect(requests).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('camera-sync.png'), fullPage: true })
    await page.getByRole('link', { name: action }).click()
    await expect(page).toHaveURL(/\/me\/ciiya-sync$/)
  })
}

test('local server-attached camera mode retains explicit connect controls', async ({ page }) => {
  let connects = 0
  await page.route('**/api/**', (route) => {
    if (route.request().url().endsWith('/api/camera/connect')) connects++
    return route.fulfill({ json: { connected: false, active: false, session: null, presets: [] } })
  })
  await page.route('**/__camera_fixture*', (route) => route.fulfill({
    contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1" />
      <style>${css}</style><div id="root"></div><script>${bundle}</script>`,
  }))
  await page.goto('/__camera_fixture?local')
  await expect.poll(() => connects).toBeGreaterThan(0)
  const connect = page.getByRole('button', { name: 'เชื่อมต่อ', exact: true })
  await expect(connect).toBeEnabled()
  await connect.click()
  await expect(page.getByText('ไม่พบกล้อง เสียบสาย USB-C แล้วลองอีกครั้ง', { exact: true })).toBeVisible()
})
