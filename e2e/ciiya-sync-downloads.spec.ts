import { test, expect } from '@playwright/test'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

let bundle = ''
let css = ''
test.beforeAll(async () => {
  // Real styles, but no auth server, live account or production request needed.
  css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), {
    from: 'src/app/globals.css',
  })).css
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import Downloads from './src/components/ciiya-sync-downloads';
        const enabled = !location.search.includes('disabled');
        const locale = new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'th';
        createRoot(document.getElementById('root')).render(<Downloads locale={locale} enabled={enabled}/>);`,
      resolveDir: process.cwd(), loader: 'tsx',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  bundle = result.outputFiles[0].text
})

test.beforeEach(async ({ page }) => {
  // Real application CSS and component, isolated from auth/devices/production data.
  await page.route('**/__sync-download-preview*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<html lang="${new URL(route.request().url()).searchParams.get('locale') === 'en' ? 'en' : 'th'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
      <body class="bg-ground text-ink"><main class="mx-auto max-w-[720px] px-4 py-6"><div id="root"></div></main><script>${bundle}</script></body></html>`,
  }))
})

test('download cards explain hardware and remain usable on small screens', async ({ page }, testInfo) => {
  await page.goto('/__sync-download-preview')
  await expect(page.getByRole('heading', { name: 'ดาวน์โหลด Ciiya Sync' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด Mac (.dmg)' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด Windows (.exe)' })).toBeEnabled()
  await expect(page.getByText(/Build 7 ต.ค. 2026/)).toBeVisible()
  await expect(page.getByText('V0.1.0 · Public Beta', { exact: true })).toBeVisible()
  await expect(page.getByText(/ผู้ใช้ยืนยันว่าทดสอบติดตั้งและใช้งานบน Windows รวมถึง Lightroom Classic ผ่านแล้ว/)).toBeVisible()
  await expect(page.getByText(/ยังไม่มีผลทดสอบ ARM64 แยกต่างหาก/)).toBeVisible()
  await expect(page.getByText(/ยังไม่ผ่านการทดสอบบนเครื่อง Windows จริง/)).toHaveCount(0)
  await expect(page.getByText(/ยังไม่เซ็นดิจิทัล ระบบอาจแจ้งเตือนก่อนติดตั้ง/)).toBeVisible()
  await expect(page.getByText('ไฟล์นี้ใช้ไม่ได้กับ Mac ชิป Intel')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByText('วิธีติดตั้งและเริ่มใช้งาน', { exact: true }).click()
  await expect(page.getByText(/Mac: เปิด .dmg/)).toBeVisible()
  await expect(page.getByText(/Windows: เปิด .exe.*SmartScreen.*More info → Run anyway/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('downloads.png'), fullPage: true })
})

test('English copy reflects user-reported Windows testing without claiming ARM64 validation', async ({ page }) => {
  await page.goto('/__sync-download-preview?locale=en')
  await expect(page.getByText(/A Windows user has confirmed successful installation and workflow tests, including Lightroom Classic/)).toBeVisible()
  await expect(page.getByText(/Separate ARM64 testing is not yet confirmed/)).toBeVisible()
  await expect(page.getByText(/Not yet tested on a Windows PC/)).toHaveCount(0)
  await expect(page.getByText('V0.1.0 · Public Beta', { exact: true })).toBeVisible()
  await expect(page.getByText(/Unsigned: your system may show a warning/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Windows (.exe)' })).toBeEnabled()
  await page.getByText('Installation and getting started', { exact: true }).click()
  await expect(page.getByText(/Windows: open the .exe.*SmartScreen.*More info → Run anyway/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('errors are recoverable and do not navigate away', async ({ page }) => {
  await page.route('**/api/ciiya-sync/download?platform=mac-arm64', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: '{"code":"INSTALLER_UNAVAILABLE"}',
  }))
  await page.goto('/__sync-download-preview')
  await page.getByRole('button', { name: 'ดาวน์โหลด Mac (.dmg)' }).click()
  await expect(page.getByRole('alert')).toContainText('ยังดาวน์โหลดไม่ได้')
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด Mac (.dmg)' })).toBeEnabled()
  await expect(page).toHaveURL(/__sync-download-preview$/)
})

test('Windows button requests the approved artifact and starts download', async ({ page }) => {
  await page.route('**/api/ciiya-sync/download?platform=windows', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ url: 'https://downloads.example.test/Ciiya-Sync.exe' }),
  }))
  await page.route('https://downloads.example.test/Ciiya-Sync.exe', (route) => route.fulfill({
    contentType: 'application/octet-stream', headers: { 'Content-Disposition': 'attachment; filename="Ciiya-Sync.exe"' }, body: 'mock installer; not executable',
  }))
  await page.goto('/__sync-download-preview')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'ดาวน์โหลด Windows (.exe)' }).click()
  expect((await download).suggestedFilename()).toBe('Ciiya-Sync.exe')
})

test('paused downloads still show compatibility and beta limitations', async ({ page }) => {
  await page.goto('/__sync-download-preview?disabled')
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด Mac (.dmg)' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด Windows (.exe)' })).toBeDisabled()
  await expect(page.getByText(/ระบบดาวน์โหลดยังไม่พร้อมสำหรับบัญชีนี้/)).toBeVisible()
})
