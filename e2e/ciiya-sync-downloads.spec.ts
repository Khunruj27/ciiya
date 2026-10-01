import { test, expect } from '@playwright/test'
import { build } from 'esbuild'

let bundle = ''
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import Downloads from './src/components/ciiya-sync-downloads';
        const enabled = !location.search.includes('disabled');
        createRoot(document.getElementById('root')).render(<Downloads locale="th" enabled={enabled}/>);`,
      resolveDir: process.cwd(), loader: 'tsx',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  bundle = result.outputFiles[0].text
})

test.beforeEach(async ({ page, request, baseURL }) => {
  // Real application CSS and component, isolated from auth/devices/production data.
  const html = await (await request.get('/login')).text()
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((match) => {
    const href = match[0].match(/href="([^"]+)"/)?.[1]
    return href ? `<link rel="stylesheet" href="${new URL(href.replaceAll('&amp;', '&'), baseURL)}">` : ''
  }).join('')
  expect(styles).not.toBe('')
  await page.route('**/__sync-download-preview*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head>
      <body class="bg-ground text-ink"><main class="mx-auto max-w-[720px] px-4 py-6"><div id="root"></div></main><script>${bundle}</script></body></html>`,
  }))
})

test('download cards explain hardware and remain usable on small screens', async ({ page }, testInfo) => {
  await page.goto('/__sync-download-preview')
  await expect(page.getByRole('heading', { name: 'ดาวน์โหลด Ciiya Sync' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด Mac (.dmg)' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด Windows (.exe)' })).toBeEnabled()
  await expect(page.getByText('ไฟล์นี้ใช้ไม่ได้กับ Mac ชิป Intel')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByText('วิธีติดตั้งและเริ่มใช้งาน', { exact: true }).click()
  await expect(page.getByText(/Mac: เปิด .dmg/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('downloads.png'), fullPage: true })
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

test('non-canary accounts see compatibility but cannot download', async ({ page }) => {
  await page.goto('/__sync-download-preview?disabled')
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด Mac (.dmg)' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด Windows (.exe)' })).toBeDisabled()
  await expect(page.getByText(/ขณะนี้เปิดให้เฉพาะบัญชีทดสอบ/)).toBeVisible()
})
