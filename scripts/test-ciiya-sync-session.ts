import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CiiyaSyncSessionTelemetryStore } from '../desktop/ciiya-sync/src/session-telemetry'
import type { CiiyaSyncQueueItem } from '../src/lib/ciiya-sync/local'

const ALBUM_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ALBUM_ID = '22222222-2222-4222-8222-222222222222'

function source(relativePath: string) {
  return readFile(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    'utf8'
  )
}

function queueItem(
  id: string,
  status: CiiyaSyncQueueItem['status'],
  overrides: Partial<CiiyaSyncQueueItem> = {}
): CiiyaSyncQueueItem {
  const now = new Date().toISOString()
  return {
    id,
    clientUploadId: id,
    albumId: ALBUM_ID,
    source: 'ciiya-sync-live-folder',
    sourcePath: `/private/photo-secret/${id}.jpg`,
    sourceVersion: '2048:1',
    fileName: `private-${id}.jpg`,
    contentType: 'image/jpeg',
    fileSizeBytes: 2_048,
    lastModifiedMs: 1,
    fileHash: null,
    requestedSize: 'original',
    categoryId: null,
    autoFaceScan: true,
    autoPublish: true,
    status,
    attempts: 0,
    nextAttemptAt: null,
    reservation: null,
    objectUploadedAt: null,
    photoId: null,
    processingStatus: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  }
}

async function telemetryStoreTest(root: string) {
  const filePath = path.join(root, 'state', 'session-telemetry.json')
  const store = new CiiyaSyncSessionTelemetryStore(filePath)
  await store.initialize()
  assert.equal((await store.snapshot()).summary, null)

  const queued = queueItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'queued')
  const exportSelection = queueItem(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'queued',
    { source: 'ciiya-sync-export-selection' }
  )
  const terminal = queueItem(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'completed'
  )
  await store.startSession({
    albumId: ALBUM_ID,
    queueItems: [queued, exportSelection, terminal],
  })

  let snapshot = await store.snapshot()
  assert.equal(snapshot.active, true)
  assert.equal(snapshot.summary?.discoveredCount, 1)
  assert.equal(snapshot.summary?.queuedCount, 1)

  const uploaded = queueItem(queued.id, 'completed', {
    updatedAt: new Date(Date.now() + 1_000).toISOString(),
    completedAt: new Date(Date.now() + 1_000).toISOString(),
  })
  assert.equal(
    await store.recordQueueEvent({ type: 'updated', item: uploaded }),
    true
  )
  assert.equal(
    await store.recordQueueEvent({
      type: 'enqueued',
      item: queueItem('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'queued', {
        albumId: OTHER_ALBUM_ID,
      }),
    }),
    false
  )

  snapshot = await store.snapshot()
  assert.equal(snapshot.summary?.completedCount, 1)
  assert.equal(snapshot.summary?.bytesCompleted, 2_048)
  assert.equal(snapshot.summary?.queuedCount, 0)

  const serialized = await readFile(filePath, 'utf8')
  assert.doesNotMatch(serialized, /photo-secret|private-|ciiya_sync_|sourcePath|fileName/)
  assert.equal((await stat(filePath)).mode & 0o777, 0o600)

  await store.stopSession('paused')
  snapshot = await store.snapshot()
  assert.equal(snapshot.active, false)
  assert.equal(snapshot.summary?.endReason, 'paused')
  assert.ok(snapshot.summary?.endedAt)

  const restored = new CiiyaSyncSessionTelemetryStore(filePath)
  await restored.initialize()
  assert.equal((await restored.snapshot()).summary?.completedCount, 1)
  await restored.startSession({ albumId: ALBUM_ID })
  assert.equal(await restored.recoverInterrupted(), true)
  assert.equal((await restored.snapshot()).summary?.endReason, 'interrupted')

  for (let index = 0; index < 22; index += 1) {
    await restored.startSession({ albumId: ALBUM_ID })
    await restored.stopSession('paused')
  }
  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.history.length, 20)
}

async function realtimeUiContractTest() {
  const [main, contracts, html, renderer, styles, docs, packageJson] =
    await Promise.all([
      source('desktop/ciiya-sync/src/main.ts'),
      source('desktop/ciiya-sync/src/contracts.ts'),
      source('desktop/ciiya-sync/renderer/index.html'),
      source('desktop/ciiya-sync/renderer/renderer.js'),
      source('desktop/ciiya-sync/renderer/styles.css'),
      source('docs/ciiya-sync.md'),
      source('package.json'),
    ])

  assert.match(main, /net\.isOnline\(\)/)
  assert.match(main, /session-telemetry\.json/)
  assert.match(main, /recordQueueEvent/)
  assert.match(main, /scheduleEmit/)
  assert.match(contracts, /waiting_network/)
  assert.match(html, /LIVE SESSION/)
  assert.match(html, /REALTIME QUEUE/)
  assert.match(html, /ประวัติ/)
  assert.match(html, /ออฟไลน์ — คิวถูกเก็บไว้ในเครื่อง/)
  assert.match(renderer, /renderSession/)
  assert.match(renderer, /setActivityView/)
  assert.match(styles, /session-overview/)
  assert.match(styles, /activity-tabs/)
  assert.match(docs, /14\.5\.7/)
  assert.match(packageJson, /test:ciiya-sync:session/)
  assert.doesNotMatch(renderer, /deviceToken|Authorization|SUPABASE|R2_/)
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ciiya-sync-session-'))
  try {
    await telemetryStoreTest(root)
    await realtimeUiContractTest()
    console.log('Ciiya Sync session, realtime status, and telemetry checks passed.')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
