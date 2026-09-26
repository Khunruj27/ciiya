import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import net from 'node:net'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CiiyaSyncLightroomBridge,
  type CiiyaSyncLightroomEnqueueInput,
} from '../desktop/ciiya-sync/src/lightroom-bridge'
import {
  CiiyaSyncBridgeSecretStore,
  CiiyaSyncLightroomPluginInstaller,
} from '../desktop/ciiya-sync/src/lightroom-plugin'
import { CiiyaSyncEngine, CiiyaSyncQueueStore } from '../src/lib/ciiya-sync/local'

const DEVICE_TOKEN = `ciiya_sync_${'e'.repeat(43)}`
const ALBUM_ID = '11111111-1111-4111-8111-111111111111'

function source(relativePath: string) {
  return readFile(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    'utf8'
  )
}

async function bridgeTest(root: string) {
  const secretPath = path.join(root, 'bridge', 'secret')
  const secretStore = new CiiyaSyncBridgeSecretStore(secretPath)
  const secret = await secretStore.loadOrCreate()
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(await secretStore.loadOrCreate(), secret)
  assert.equal((await stat(secretPath)).mode & 0o777, 0o600)

  const enqueued: CiiyaSyncLightroomEnqueueInput[] = []
  const bridge = new CiiyaSyncLightroomBridge({
    secret,
    port: 0,
    async albums() {
      return [{ id: ALBUM_ID, title: 'งานแต่ง แอร์ & ปลื้ม', photoCount: 12 }]
    },
    async enqueue(input) {
      enqueued.push(input)
      return { id: crypto.randomUUID(), created: true }
    },
  })
  const port = await bridge.start()
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    assert.equal((await fetch(`${baseUrl}/v1/albums`)).status, 401)
    const albumResponse = await fetch(`${baseUrl}/v1/albums`, {
      headers: { 'X-Ciiya-Sync-Secret': secret },
    })
    assert.equal(albumResponse.status, 200)
    const albumBody = await albumResponse.text()
    assert.match(albumBody, /status=ok&version=1/)
    assert.match(albumBody, new RegExp(`albumId=${ALBUM_ID}`))
    assert.match(albumBody, /title=/)

    const sourcePath = path.join(root, 'archive', 'portrait 01.jpg')
    const enqueueResponse = await fetch(`${baseUrl}/v1/export/enqueue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'X-Ciiya-Sync-Secret': secret,
      },
      body: new URLSearchParams({ albumId: ALBUM_ID, sourcePath }),
    })
    assert.equal(enqueueResponse.status, 201)
    assert.deepEqual(enqueued, [{ albumId: ALBUM_ID, sourcePath }])
  } finally {
    await bridge.stop()
  }
}

async function bridgeShutdownDeadlineTest() {
  const bridge = new CiiyaSyncLightroomBridge({
    secret: crypto.randomBytes(32).toString('base64url'),
    port: 0,
    async albums() {
      return []
    },
    async enqueue() {
      return { id: crypto.randomUUID(), created: true }
    },
  })
  const port = await bridge.start()
  const socket = net.createConnection({ host: '127.0.0.1', port })
  await once(socket, 'connect')

  const startedAt = Date.now()
  await bridge.stop()
  assert.ok(
    Date.now() - startedAt < 2_500,
    'Lightroom bridge shutdown must not hang on an open local socket'
  )
  socket.destroy()
}

async function pluginInstallerTest(root: string) {
  const sourcePath = fileURLToPath(
    new URL(
      '../desktop/ciiya-sync/lightroom/CiiyaSync.lrplugin',
      import.meta.url
    )
  )
  const modulesPath = path.join(root, 'Lightroom', 'Modules')
  const installer = new CiiyaSyncLightroomPluginInstaller(
    sourcePath,
    'darwin',
    modulesPath
  )
  assert.equal((await installer.status()).installed, false)

  const secret = crypto.randomBytes(32).toString('base64url')
  const status = await installer.install({ port: 51_673, secret })
  assert.equal(status.installed, true)
  assert.equal(status.version, '0.1.0')
  assert.ok(status.pluginPath)

  const configPath = path.join(status.pluginPath!, 'BridgeConfig.lua')
  const config = await readFile(configPath, 'utf8')
  assert.match(config, /http:\/\/127\.0\.0\.1:51673/)
  assert.match(config, new RegExp(secret))
  assert.equal((await stat(configPath)).mode & 0o777, 0o600)
  assert.match(
    await readFile(path.join(status.pluginPath!, 'Info.lua'), 'utf8'),
    /LrExportServiceProvider/
  )
}

async function processingOnlyEngineTest(root: string) {
  const archivePath = path.join(root, 'archive-photo.jpg')
  const bytes = Buffer.from('lightroom-export-selection')
  await writeFile(archivePath, bytes)
  const fileStat = await stat(archivePath)
  const queue = new CiiyaSyncQueueStore(path.join(root, 'state', 'queue.json'))
  let finalSource = ''

  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/photos/upload-url')) {
      const body = JSON.parse(String(init?.body))
      return Response.json({
        success: true,
        provider: 'r2',
        bucket: 'ciiya-app',
        storagePath: `${ALBUM_ID}/${ALBUM_ID}/original/${crypto.randomUUID()}.jpg`,
        uploadSessionId: crypto.randomUUID(),
        uploadUrl: 'https://r2.test/lightroom-export',
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        fileHash: body.fileHash,
      })
    }
    if (url === 'https://r2.test/lightroom-export') {
      assert.deepEqual(
        Buffer.from(await new Response(init?.body as BodyInit).arrayBuffer()),
        bytes
      )
      return new Response(null, { status: 200 })
    }
    if (url.endsWith('/api/photos/finalize-upload')) {
      const body = JSON.parse(String(init?.body))
      finalSource = body.uploadSource
      return Response.json({
        success: true,
        duplicate: false,
        photoId: crypto.randomUUID(),
        processingStatus: 'pending',
      })
    }
    throw new Error(`Unexpected Lightroom engine request: ${url}`)
  }

  const engine = new CiiyaSyncEngine({
    apiBaseUrl: 'https://ciiya.test',
    deviceToken: DEVICE_TOKEN,
    stateFilePath: queue.stateFilePath,
    queueStore: queue,
    watchFolder: false,
    retryBaseMs: 20,
    fetchImplementation: mockFetch,
  })
  await engine.start()
  try {
    const result = await engine.enqueueFile(
      {
        sourcePath: archivePath,
        fileName: path.basename(archivePath),
        contentType: 'image/jpeg',
        fileSizeBytes: fileStat.size,
        lastModifiedMs: fileStat.mtimeMs,
      },
      'ciiya-sync-export-selection',
      ALBUM_ID
    )
    assert.equal(result.created, true)
    assert.equal(await engine.waitForIdle(5_000), true)
    assert.equal((await queue.get(result.item.id))?.status, 'completed')
    assert.equal(finalSource, 'ciiya-sync-export-selection')
  } finally {
    await engine.stop()
  }
}

async function pluginContractTest() {
  const [info, provider, bridge, main, preload, build] = await Promise.all([
    source('desktop/ciiya-sync/lightroom/CiiyaSync.lrplugin/Info.lua'),
    source(
      'desktop/ciiya-sync/lightroom/CiiyaSync.lrplugin/CiiyaExportServiceProvider.lua'
    ),
    source('desktop/ciiya-sync/lightroom/CiiyaSync.lrplugin/CiiyaBridge.lua'),
    source('desktop/ciiya-sync/src/main.ts'),
    source('desktop/ciiya-sync/src/preload.ts'),
    source('desktop/ciiya-sync/build.mjs'),
  ])
  assert.match(info, /LrExportServiceProvider/)
  assert.match(provider, /hideSections = \{ 'exportLocation' \}/)
  assert.match(provider, /LrFileUtils\.copy/)
  assert.match(provider, /Bridge\.enqueue/)
  assert.match(bridge, /X-Ciiya-Sync-Secret/)
  assert.doesNotMatch(bridge, /ciiya_sync_[A-Za-z0-9_-]/)
  assert.match(main, /ciiya-sync-export-selection/)
  assert.match(preload, /install-lightroom-plugin/)
  assert.match(build, /'lightroom'/)
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ciiya-sync-lightroom-'))
  try {
    await bridgeTest(root)
    await bridgeShutdownDeadlineTest()
    await pluginInstallerTest(root)
    await processingOnlyEngineTest(root)
    await pluginContractTest()
    console.log('Ciiya Sync Lightroom Export Selection checks passed.')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
