import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  CiiyaSyncEngine,
  CiiyaSyncQueueStore,
  CiiyaSyncSourceChangedError,
  CiiyaSyncUploadClient,
  StableFileWatcher,
  type CiiyaSyncQueueItem,
} from '../src/lib/ciiya-sync/local'

const DEVICE_TOKEN = `ciiya_sync_${'a'.repeat(43)}`
const ALBUM_ID = '11111111-1111-4111-8111-111111111111'

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for Ciiya Sync test condition')
}

async function queuePersistenceTest(root: string) {
  const stateFilePath = path.join(root, 'state', 'queue.json')
  const photoPath = path.join(root, 'queue-photo.jpg')
  await writeFile(photoPath, Buffer.from('queue-photo'))
  const photoStat = await stat(photoPath)
  const store = new CiiyaSyncQueueStore(stateFilePath)

  const first = await store.enqueue({
    albumId: ALBUM_ID,
    source: 'ciiya-sync-live-folder',
    sourcePath: photoPath,
    fileName: path.basename(photoPath),
    contentType: 'image/jpeg',
    fileSizeBytes: photoStat.size,
    lastModifiedMs: photoStat.mtimeMs,
  })
  const duplicate = await store.enqueue({
    albumId: ALBUM_ID,
    source: 'ciiya-sync-live-folder',
    sourcePath: photoPath,
    fileName: path.basename(photoPath),
    contentType: 'image/jpeg',
    fileSizeBytes: photoStat.size,
    lastModifiedMs: photoStat.mtimeMs,
  })

  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(first.item.id, duplicate.item.id)

  await store.update(first.item.id, {
    status: 'uploading',
    reservation: {
      provider: 'r2',
      bucket: 'ciiya-app',
      storagePath: `${ALBUM_ID}/${ALBUM_ID}/original/test.jpg`,
      uploadSessionId: '22222222-2222-4222-8222-222222222222',
      fileHash: 'b'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  })

  const rawState = await readFile(stateFilePath, 'utf8')
  assert.doesNotMatch(rawState, /ciiya_sync_/)

  const restarted = new CiiyaSyncQueueStore(stateFilePath)
  assert.equal(await restarted.recoverInterrupted(), 1)
  assert.equal((await restarted.get(first.item.id))?.status, 'queued')

  await restarted.update(first.item.id, {
    status: 'finalizing',
    objectUploadedAt: new Date().toISOString(),
  })
  const resumed = new CiiyaSyncQueueStore(stateFilePath)
  assert.equal(await resumed.recoverInterrupted(), 1)
  assert.equal((await resumed.get(first.item.id))?.status, 'finalizing')

  const beforeCancel = await resumed.get(first.item.id)
  await resumed.cancel(first.item.id)
  const retried = await resumed.retry(first.item.id)
  assert.equal(retried?.status, 'queued')
  assert.notEqual(retried?.clientUploadId, beforeCancel?.clientUploadId)
  assert.equal(retried?.reservation, null)
  assert.equal(retried?.objectUploadedAt, null)
  assert.equal(retried?.completedAt, null)
}

async function stableWatcherTest(root: string) {
  const folderPath = path.join(root, 'watch')
  const photoPath = path.join(folderPath, 'capture.jpg')
  await mkdir(folderPath, { recursive: true })
  await writeFile(photoPath, Buffer.from('first'))

  const stableFiles: Array<{ fileSizeBytes: number; sourcePath: string }> = []
  const watcher = new StableFileWatcher({
    folderPath,
    stableForMs: 500,
    pollIntervalMs: 200,
    onStableFile(file) {
      stableFiles.push(file)
    },
  })

  await watcher.start()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await appendFile(photoPath, Buffer.from('-second'))
  await waitFor(() => stableFiles.length === 1, 3_000)
  await watcher.stop()

  assert.equal(stableFiles.length, 1)
  assert.equal(stableFiles[0].sourcePath, photoPath)
  assert.equal(stableFiles[0].fileSizeBytes, Buffer.byteLength('first-second'))
}

async function uploadClientTest(root: string) {
  const photoPath = path.join(root, 'client-photo.jpg')
  const bytes = Buffer.from('rendered-lightroom-photo')
  await writeFile(photoPath, bytes)
  const photoStat = await stat(photoPath)
  const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex')
  const clientUploadId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const objectKey = `${ALBUM_ID}/${ALBUM_ID}/original/${crypto.randomUUID()}.jpg`
  const calls: string[] = []

  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push(`${init?.method || 'GET'} ${url}`)

    if (url.endsWith('/api/photos/upload-url')) {
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        `Bearer ${DEVICE_TOKEN}`
      )
      const body = JSON.parse(String(init?.body))
      assert.equal(body.fileHash, expectedHash)
      assert.equal(body.presetPath, undefined)
      return Response.json({
        success: true,
        provider: 'r2',
        bucket: 'ciiya-app',
        storagePath: objectKey,
        uploadSessionId: sessionId,
        uploadUrl: 'https://r2.test/signed-object',
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        fileHash: expectedHash,
      })
    }

    if (url === 'https://r2.test/signed-object') {
      const headers = new Headers(init?.headers)
      assert.equal(headers.has('authorization'), false)
      assert.equal(headers.get('content-length'), String(bytes.byteLength))
      const uploaded = Buffer.from(
        await new Response(init?.body as BodyInit).arrayBuffer()
      )
      assert.deepEqual(uploaded, bytes)
      return new Response(null, { status: 200 })
    }

    if (url.endsWith('/api/photos/finalize-upload')) {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.uploadSource, 'ciiya-sync-live-folder')
      assert.equal(body.uploadSessionId, sessionId)
      return Response.json({
        success: true,
        duplicate: false,
        photoId: '33333333-3333-4333-8333-333333333333',
        processingStatus: 'pending',
      })
    }

    throw new Error(`Unexpected request: ${url}`)
  }

  const item: CiiyaSyncQueueItem = {
    id: crypto.randomUUID(),
    clientUploadId,
    albumId: ALBUM_ID,
    source: 'ciiya-sync-live-folder',
    sourcePath: photoPath,
    sourceVersion: `${photoStat.size}:${Math.trunc(photoStat.mtimeMs)}`,
    fileName: path.basename(photoPath),
    contentType: 'image/jpeg',
    fileSizeBytes: photoStat.size,
    lastModifiedMs: photoStat.mtimeMs,
    fileHash: null,
    requestedSize: 'original',
    categoryId: null,
    autoFaceScan: true,
    autoPublish: true,
    status: 'queued',
    attempts: 0,
    nextAttemptAt: null,
    reservation: null,
    objectUploadedAt: null,
    photoId: null,
    processingStatus: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  }
  const client = new CiiyaSyncUploadClient({
    baseUrl: 'https://ciiya.test',
    deviceToken: DEVICE_TOKEN,
    fetchImplementation: mockFetch,
  })
  let persistedHash = ''
  let persistedReservation: unknown = null
  let objectUploadedAt = ''
  const outcome = await client.process(item, {
    onHashed(fileHash) {
      persistedHash = fileHash
    },
    onReserved(reservation) {
      persistedReservation = reservation
    },
    onObjectUploaded(uploadedAt) {
      objectUploadedAt = uploadedAt
    },
  })

  assert.equal(persistedHash, expectedHash)
  assert.ok(persistedReservation)
  assert.ok(objectUploadedAt)
  assert.equal(outcome.duplicate, false)
  assert.equal(calls.length, 3)
}

async function sourceMutationTest(root: string) {
  const photoPath = path.join(root, 'changing-photo.jpg')
  await writeFile(photoPath, Buffer.from('before-change'))
  const photoStat = await stat(photoPath)
  const sessionId = crypto.randomUUID()
  let cancelled = false

  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input)

    if (url.endsWith('/api/photos/upload-url') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      return Response.json({
        success: true,
        provider: 'r2',
        bucket: 'ciiya-app',
        storagePath: `${ALBUM_ID}/${ALBUM_ID}/original/${crypto.randomUUID()}.jpg`,
        uploadSessionId: sessionId,
        uploadUrl: 'https://r2.test/changing-object',
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        fileHash: body.fileHash,
      })
    }

    if (url === 'https://r2.test/changing-object') {
      await new Response(init?.body as BodyInit).arrayBuffer()
      await appendFile(photoPath, Buffer.from('-after-upload'))
      return new Response(null, { status: 200 })
    }

    if (url.endsWith('/api/photos/upload-url') && init?.method === 'DELETE') {
      cancelled = true
      return Response.json({ success: true, cancelled: true })
    }

    throw new Error(`Unexpected request: ${url}`)
  }

  const item: CiiyaSyncQueueItem = {
    id: crypto.randomUUID(),
    clientUploadId: crypto.randomUUID(),
    albumId: ALBUM_ID,
    source: 'ciiya-sync-live-folder',
    sourcePath: photoPath,
    sourceVersion: `${photoStat.size}:${Math.trunc(photoStat.mtimeMs)}`,
    fileName: path.basename(photoPath),
    contentType: 'image/jpeg',
    fileSizeBytes: photoStat.size,
    lastModifiedMs: photoStat.mtimeMs,
    fileHash: null,
    requestedSize: 'original',
    categoryId: null,
    autoFaceScan: true,
    autoPublish: false,
    status: 'queued',
    attempts: 0,
    nextAttemptAt: null,
    reservation: null,
    objectUploadedAt: null,
    photoId: null,
    processingStatus: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  }
  const client = new CiiyaSyncUploadClient({
    baseUrl: 'https://ciiya.test',
    deviceToken: DEVICE_TOKEN,
    fetchImplementation: mockFetch,
  })

  await assert.rejects(() => client.process(item), CiiyaSyncSourceChangedError)
  assert.equal(cancelled, true)
}

async function offlineRecoveryTest(root: string) {
  const folderPath = path.join(root, 'offline-watch')
  const stateFilePath = path.join(root, 'offline-state', 'queue.json')
  await mkdir(folderPath, { recursive: true })
  await writeFile(path.join(folderPath, '.keep'), '')
  const photoPath = path.join(folderPath, 'offline.jpg')
  const sessionId = crypto.randomUUID()
  const objectKey = `${ALBUM_ID}/${ALBUM_ID}/original/${crypto.randomUUID()}.jpg`
  let reserveAttempts = 0

  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input)

    if (url.endsWith('/api/photos/upload-url')) {
      reserveAttempts += 1
      if (reserveAttempts === 1) throw new TypeError('fetch failed')
      const body = JSON.parse(String(init?.body))
      return Response.json({
        success: true,
        provider: 'r2',
        bucket: 'ciiya-app',
        storagePath: objectKey,
        uploadSessionId: sessionId,
        uploadUrl: 'https://r2.test/offline-object',
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        fileHash: body.fileHash,
      })
    }

    if (url === 'https://r2.test/offline-object') {
      await new Response(init?.body as BodyInit).arrayBuffer()
      return new Response(null, { status: 200 })
    }

    if (url.endsWith('/api/photos/finalize-upload')) {
      return Response.json({
        success: true,
        photoId: crypto.randomUUID(),
        processingStatus: 'pending',
      })
    }

    throw new Error(`Unexpected request: ${url}`)
  }

  const engine = new CiiyaSyncEngine({
    apiBaseUrl: 'https://ciiya.test',
    deviceToken: DEVICE_TOKEN,
    albumId: ALBUM_ID,
    folderPath,
    stateFilePath,
    stableForMs: 500,
    pollIntervalMs: 200,
    retryBaseMs: 1_000,
    retryMaxMs: 1_000,
    retryJitter: 0,
    fetchImplementation: mockFetch,
  })

  await engine.start()
  await writeFile(photoPath, Buffer.from('offline-recovery-photo'))
  await waitFor(async () => {
    const item = (await engine.queue.list())[0]
    return item?.status === 'completed'
  }, 7_000)
  await engine.stop()

  assert.equal(reserveAttempts, 2)
  assert.equal((await engine.queue.list())[0]?.attempts, 1)
  const persisted = await readFile(stateFilePath, 'utf8')
  assert.doesNotMatch(persisted, /ciiya_sync_/)
}

async function offlineRestartRecoveryTest(root: string) {
  const stateFilePath = path.join(root, 'restart-state', 'queue.json')
  const photoPath = path.join(root, 'restart-offline.jpg')
  const bytes = Buffer.from('offline-restart-recovery-photo')
  await writeFile(photoPath, bytes)
  const photoStat = await stat(photoPath)

  const firstQueue = new CiiyaSyncQueueStore(stateFilePath)
  const firstEngine = new CiiyaSyncEngine({
    apiBaseUrl: 'https://ciiya.test',
    deviceToken: DEVICE_TOKEN,
    stateFilePath,
    queueStore: firstQueue,
    watchFolder: false,
    retryBaseMs: 100,
    retryMaxMs: 100,
    retryJitter: 0,
    fetchImplementation: async () => {
      throw new TypeError('fetch failed while offline')
    },
  })

  await firstEngine.start()
  const queued = await firstEngine.enqueueFile(
    {
      sourcePath: photoPath,
      fileName: path.basename(photoPath),
      contentType: 'image/jpeg',
      fileSizeBytes: photoStat.size,
      lastModifiedMs: photoStat.mtimeMs,
    },
    'ciiya-sync-live-folder',
    ALBUM_ID
  )
  await waitFor(
    async () => (await firstQueue.get(queued.item.id))?.status === 'retry_wait'
  )
  await firstEngine.stop()

  const sessionId = crypto.randomUUID()
  const secondQueue = new CiiyaSyncQueueStore(stateFilePath)
  const secondEngine = new CiiyaSyncEngine({
    apiBaseUrl: 'https://ciiya.test',
    deviceToken: DEVICE_TOKEN,
    stateFilePath,
    queueStore: secondQueue,
    watchFolder: false,
    retryBaseMs: 20,
    retryMaxMs: 20,
    retryJitter: 0,
    fetchImplementation: async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/photos/upload-url')) {
        const body = JSON.parse(String(init?.body))
        return Response.json({
          success: true,
          provider: 'r2',
          bucket: 'ciiya-app',
          storagePath: `${ALBUM_ID}/${ALBUM_ID}/original/${crypto.randomUUID()}.jpg`,
          uploadSessionId: sessionId,
          uploadUrl: 'https://r2.test/restart-object',
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          fileHash: body.fileHash,
        })
      }
      if (url === 'https://r2.test/restart-object') {
        assert.equal(
          new Headers(init?.headers).get('content-length'),
          String(bytes.byteLength)
        )
        await new Response(init?.body as BodyInit).arrayBuffer()
        return new Response(null, { status: 200 })
      }
      if (url.endsWith('/api/photos/finalize-upload')) {
        return Response.json({
          success: true,
          photoId: crypto.randomUUID(),
          processingStatus: 'pending',
        })
      }
      throw new Error(`Unexpected restart request: ${url}`)
    },
  })

  await secondEngine.start()
  try {
    await waitFor(
      async () => (await secondQueue.get(queued.item.id))?.status === 'completed'
    )
    const completed = await secondQueue.get(queued.item.id)
    assert.equal(completed?.attempts, 1)
    assert.equal(completed?.status, 'completed')
    assert.equal((await stat(photoPath)).isFile(), true)
  } finally {
    await secondEngine.stop()
  }
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ciiya-sync-'))

  try {
    await queuePersistenceTest(root)
    await stableWatcherTest(root)
    await uploadClientTest(root)
    await sourceMutationTest(root)
    await offlineRecoveryTest(root)
    await offlineRestartRecoveryTest(root)
    console.log('Ciiya Sync local queue and offline recovery checks passed.')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
