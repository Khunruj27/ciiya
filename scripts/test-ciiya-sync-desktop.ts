import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CiiyaSyncDesktopApi } from '../desktop/ciiya-sync/src/api-client'
import {
  CiiyaSyncCredentialStore,
  CiiyaSyncSettingsStore,
  desktopPlatform,
} from '../desktop/ciiya-sync/src/settings-store'

const DEVICE_TOKEN = `ciiya_sync_${'d'.repeat(43)}`
const DEVICE_ID = '11111111-1111-4111-8111-111111111111'
const OWNER_ID = '22222222-2222-4222-8222-222222222222'
const ALBUM_ID = '33333333-3333-4333-8333-333333333333'

function source(relativePath: string) {
  return readFile(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    'utf8'
  )
}

async function settingsAndCredentialsTest(root: string) {
  const settingsPath = path.join(root, 'state', 'settings.json')
  const tokenPath = path.join(root, 'state', 'device-token.bin')
  const settingsStore = new CiiyaSyncSettingsStore(
    settingsPath,
    'https://ciiya.test/'
  )

  const initial = await settingsStore.load()
  assert.equal(initial.apiBaseUrl, 'https://ciiya.test')
  assert.match(initial.clientDeviceId, /^[0-9a-f-]{36}$/i)
  assert.equal(initial.folderPath, null)

  const updated = await settingsStore.update({
    albumId: ALBUM_ID,
    folderPath: path.join(root, 'lightroom-export'),
    deviceId: DEVICE_ID,
    ownerId: OWNER_ID,
    tokenExpiresAt: '2026-12-01T00:00:00.000Z',
    autoStart: true,
  })
  assert.equal(updated.albumId, ALBUM_ID)
  assert.equal(updated.autoStart, true)
  assert.equal(updated.clientDeviceId, initial.clientDeviceId)

  const key = Buffer.from('ciiya-desktop-test-key')
  const credentialStore = new CiiyaSyncCredentialStore(tokenPath, {
    isAvailable: () => true,
    encrypt(value) {
      const bytes = Buffer.from(value)
      return Buffer.from(bytes.map((byte, index) => byte ^ key[index % key.length]))
    },
    decrypt(value) {
      const bytes = Buffer.from(value)
      return Buffer.from(
        bytes.map((byte, index) => byte ^ key[index % key.length])
      ).toString('utf8')
    },
  })

  await credentialStore.save(DEVICE_TOKEN)
  assert.equal(await credentialStore.load(), DEVICE_TOKEN)
  assert.doesNotMatch(await readFile(tokenPath, 'utf8'), /ciiya_sync_/)
  assert.doesNotMatch(await readFile(settingsPath, 'utf8'), /ciiya_sync_/)
  await credentialStore.clear()
  assert.equal(await credentialStore.load(), null)
}

async function desktopApiTest() {
  const calls: Array<{ url: string; authorization: string | null }> = []
  let polling = 0
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    const authorization = new Headers(init?.headers).get('authorization')
    calls.push({ url, authorization })

    if (url.endsWith('/api/ciiya-sync/pairing/start')) {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.clientDeviceId, DEVICE_ID)
      assert.equal(body.platform, 'macos')
      return Response.json(
        {
          pairingId: '44444444-4444-4444-8444-444444444444',
          userCode: 'ABCD-EFGH',
          pollSecret: 'p'.repeat(43),
          verificationUriComplete: 'https://ciiya.test/connect/ciiya-sync?code=ABCD-EFGH',
          expiresAt: '2026-09-23T12:00:00.000Z',
          interval: 3,
        },
        { status: 201 }
      )
    }

    if (url.endsWith('/api/ciiya-sync/pairing/status')) {
      polling += 1
      if (polling === 1) {
        return Response.json({ paired: false, status: 'pending' }, { status: 202 })
      }
      return Response.json({
        paired: true,
        status: 'consumed',
        deviceId: DEVICE_ID,
        ownerId: OWNER_ID,
        deviceToken: DEVICE_TOKEN,
        expiresAt: '2026-12-01T00:00:00.000Z',
      })
    }

    if (url.endsWith('/api/ciiya-sync/albums')) {
      assert.equal(authorization, `Bearer ${DEVICE_TOKEN}`)
      return Response.json({
        success: true,
        albums: [
          {
            id: ALBUM_ID,
            title: 'Lightroom Live',
            description: null,
            cover_url: null,
            status: 'active',
            photo_count: 14,
            updated_at: '2026-09-23T10:00:00.000Z',
          },
        ],
      })
    }

    throw new Error(`Unexpected desktop API request: ${url}`)
  }

  const api = new CiiyaSyncDesktopApi('https://ciiya.test/', mockFetch)
  const started = await api.startPairing({
    clientDeviceId: DEVICE_ID,
    deviceName: 'Studio Mac',
    platform: 'macos',
    appVersion: '0.1.0',
  })
  assert.equal(started.userCode, 'ABCD-EFGH')
  assert.equal(
    (await api.pairingStatus({
      pairingId: started.pairingId,
      pollSecret: started.pollSecret,
    })).paired,
    false
  )
  const paired = await api.pairingStatus({
    pairingId: started.pairingId,
    pollSecret: started.pollSecret,
  })
  assert.equal(paired.deviceToken, DEVICE_TOKEN)
  const albums = await api.albums(DEVICE_TOKEN)
  assert.equal(albums[0].id, ALBUM_ID)
  assert.equal(albums[0].photoCount, 14)
  assert.equal(calls.filter((call) => call.authorization).length, 1)
}

async function desktopSecurityContractTest() {
  const [main, preload, renderer, html, buildConfig, packageJson] = await Promise.all([
    source('desktop/ciiya-sync/src/main.ts'),
    source('desktop/ciiya-sync/src/preload.ts'),
    source('desktop/ciiya-sync/renderer/renderer.js'),
    source('desktop/ciiya-sync/renderer/index.html'),
    source('desktop/ciiya-sync/electron-builder.yml'),
    source('package.json'),
  ])

  assert.match(main, /contextIsolation: true/)
  assert.match(main, /nodeIntegration: false/)
  assert.match(main, /sandbox: true/)
  assert.match(main, /safeStorage\.encryptString/)
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
  assert.match(main, /CiiyaSyncEngine/)
  assert.match(preload, /contextBridge\.exposeInMainWorld/)
  assert.doesNotMatch(preload, /deviceToken/)
  assert.doesNotMatch(renderer, /deviceToken|Authorization|SUPABASE|R2_/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(buildConfig, /co\.ciiya\.sync/)
  assert.match(buildConfig, /target: dmg/)
  assert.match(buildConfig, /target: nsis/)
  assert.match(packageJson, /build:ciiya-sync:desktop/)
  assert.match(packageJson, /dist:ciiya-sync:mac/)
  assert.match(packageJson, /dist:ciiya-sync:win/)
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ciiya-sync-desktop-'))
  try {
    assert.equal(desktopPlatform('darwin'), 'macos')
    assert.equal(desktopPlatform('win32'), 'windows')
    await settingsAndCredentialsTest(root)
    await desktopApiTest()
    await desktopSecurityContractTest()
    console.log('Ciiya Sync desktop shell and security checks passed.')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
