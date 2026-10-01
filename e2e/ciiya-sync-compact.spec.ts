import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Real packaged renderer, isolated IPC fixture. No credentials, real uploads,
// Lightroom installation, or changes to the user's local queue.
test.use({ viewport: { width: 780, height: 592 } })

async function mount(page: Page, connected = true) {
  await page.addInitScript(({ connected }) => {
    const queue = Array.from({ length: 35 }, (_, index) => ({
      id: String(index), albumId: 'album-1', fileName: 'Studio-' + (1000 + index) + '.jpg',
      fileSizeBytes: 4500000, status: 'completed', attempts: 1,
      completedAt: '2026-10-01T10:42:00Z', updatedAt: '2026-10-01T10:42:00Z',
    }))
    const state = {
      appVersion: '0.1.0', releaseChannel: 'canary', connected,
      settings: { albumId: 'album-1', folderPath: '/Pictures/Lightroom/Export', autoStart: false },
      pairing: { status: 'idle', userCode: null },
      albums: [{ id: 'album-1', title: 'Studio Portrait', photoCount: 35 },
        { id: 'album-2', title: 'Wedding Gallery', photoCount: 0 }],
      albumsLoading: false, sync: { running: false, message: 'พร้อมรับภาพใหม่จาก Lightroom', lastError: null },
      session: { active: false, status: 'paused', networkOnline: true, albumTitle: 'Studio Portrait', folderName: 'Export',
        summary: { startedAt: '2026-10-01T10:40:00Z', endedAt: '2026-10-01T10:45:17Z', lastActivityAt: '2026-10-01T10:42:00Z',
          discoveredCount: 35, completedCount: 35, duplicateCount: 0, bytesCompleted: 157500000,
          activeCount: 0, queuedCount: 0, retryCount: 0, failedCount: 0 } },
      lightroom: { supported: true, installed: true, installationState: 'ready', version: '0.1.1', bridgeReady: true, bridgeError: null },
      queue,
    }
    let listener: (state: unknown) => void = () => {}
    const calls: string[] = []
    const result = (name: string) => { calls.push(name); return Promise.resolve(structuredClone(state)) }
    Object.assign(window, {
      syncFixture: { state, calls, emit: () => listener(structuredClone(state)) },
      ciiyaSync: {
        getState: () => result('getState'), onState: (fn: typeof listener) => { listener = fn; return () => {} },
        refreshAlbums: () => result('refreshAlbums'),
        savePreferences: (prefs: object) => { Object.assign(state.settings, prefs); return result('savePreferences') },
        chooseFolder: () => { state.settings.folderPath = '/Pictures/New Export'; return result('chooseFolder') },
        startSync: () => { state.sync.running = true; state.session.active = true; return result('startSync') },
        stopSync: () => { state.sync.running = false; state.session.active = false; return result('stopSync') },
        retryItem: (id: string) => { state.queue.find(item => item.id === id)!.status = 'queued'; return result('retryItem') },
        cancelItem: (id: string) => { state.queue.find(item => item.id === id)!.status = 'cancelled'; return result('cancelItem') },
        installLightroomPlugin: () => result('installLightroomPlugin'),
        openLightroomPluginFolder: () => { calls.push('openLightroomPluginFolder'); return Promise.resolve() },
        startPairing: () => { Object.assign(state.pairing, { status: 'waiting', userCode: 'ABCD-EFGH' }); return result('startPairing') },
        openPairingPage: () => Promise.resolve(),
        disconnect: () => { state.connected = false; return result('disconnect') },
      },
    })
  }, { connected })
  const root = path.resolve('dist/ciiya-sync/renderer')
  await page.route('https://ciiya-sync.test/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1) || 'index.html'
    const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' }
    await route.fulfill({ body: await readFile(path.join(root, file)), contentType: types[path.extname(file)] })
  })
  await page.goto('https://ciiya-sync.test/index.html')
  await expect(page.locator(connected ? '#workspace' : '#setup-view')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

async function update(page: Page, mutate: string) {
  await page.evaluate(mutate + '; window.syncFixture.emit()')
}

for (const width of [780, 720]) {
  test('compact renderer fits ' + width + 'px with bounded history', async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 780 ? 592 : 572 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await mount(page)
    await expect(page.locator('#activity-feed .queue-item')).toHaveCount(35)
    await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open', '')
    await expect(page.locator('#sync-button')).toBeInViewport()
    await expect(page.locator('.session-details > summary')).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    expect(await page.locator('#activity-feed').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    expect(await page.locator('.brand-wordmark').evaluate(el => getComputedStyle(el).maskImage)).toContain('logo-usage.svg')
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(245, 245, 247)')
    expect(await page.locator('#sync-button').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 113, 227)')
    expect(await page.locator('.panel').first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)')
    await page.screenshot({ path: info.outputPath('compact.png') })
    expect(errors).toEqual([])
  })
}

test('album, folder, start/pause, advanced settings and plugin guide still work', async ({ page }) => {
  await mount(page)
  await page.locator('#album-select').selectOption('album-2')
  await expect(page.locator('#album-select')).toHaveValue('album-2')
  await page.locator('#folder-button').click()
  await expect(page.locator('#folder-name')).toHaveText('New Export')
  await page.locator('#sync-button').click()
  await expect(page.locator('#album-select')).toBeDisabled()
  await expect(page.locator('#folder-button')).toBeDisabled()
  await expect(page.locator('#sync-button')).toHaveText('หยุดซิงก์ชั่วคราว')
  await page.locator('#sync-button').click()
  await expect(page.locator('#album-select')).toBeEnabled()
  await page.locator('#advanced-settings > summary').click()
  await page.locator('.toggle-row').click()
  await expect(page.locator('#autostart-toggle')).toBeChecked()
  await page.locator('#install-lightroom-button').click()
  await expect(page.locator('#lightroom-install-dialog')).toBeVisible()
  await page.locator('#dialog-lightroom-folder-button').click()
  await page.locator('#close-lightroom-dialog-button').click()
  await expect(page.locator('#lightroom-install-dialog')).not.toBeVisible()
  await page.locator('.session-details > summary').click()
  await expect(page.locator('#session-duration')).toHaveText('00:05:17')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('offline, retry and plugin attention remain discoverable', async ({ page }, info) => {
  await mount(page)
  await update(page, `Object.assign(window.syncFixture.state.session, { networkOnline: false });
    window.syncFixture.state.queue[0].status = 'retry_wait';
    window.syncFixture.state.queue[0].error = { message: 'รอเชื่อมต่ออินเทอร์เน็ต' };
    window.syncFixture.state.session.summary.retryCount = 1;
    window.syncFixture.state.lightroom.installationState = 'repair_required'`)
  await expect(page.locator('#offline-banner')).toBeVisible()
  await expect(page.locator('#plugin-attention')).toHaveText('ตรวจสอบปลั๊กอิน')
  await expect(page.locator('#queue-tab')).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'ลองส่ง Studio-1000.jpg ใหม่ตอนนี้' }).click()
  await expect(page.locator('#activity-feed')).toContainText('รอส่ง')
  await page.getByRole('button', { name: 'ยกเลิก Studio-1000.jpg' }).click()
  await expect(page.locator('#history-tab')).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({ path: info.outputPath('offline.png') })
})

test('empty state, long paths and connection screen fit', async ({ page }, info) => {
  await mount(page)
  await update(page, `window.syncFixture.state.queue = [];
    window.syncFixture.state.settings.folderPath = '/Pictures/' + 'Long folder '.repeat(20);
    window.syncFixture.state.albums[0].title = 'อัลบั้มทดสอบชื่อยาว'.repeat(15)`)
  await expect(page.locator('#empty-state')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await update(page, 'window.syncFixture.state.connected = false')
  await expect(page.locator('#setup-view')).toBeVisible()
  await page.screenshot({ path: info.outputPath('connect.png') })
  await page.locator('#connect-button').click()
  await expect(page.locator('#pair-code')).toHaveText('ABCD-EFGH')
  await expect(page.locator('#pair-code')).toBeInViewport()
})
