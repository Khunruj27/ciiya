import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCiiyaSyncReleaseManifest } from './build-ciiya-sync-release-manifest'
import {
  getCiiyaSyncRolloutDecision,
  getCiiyaSyncRolloutMode,
} from '../src/lib/ciiya-sync/rollout'
import {
  CiiyaSyncEngine,
  CiiyaSyncQueueStore,
} from '../src/lib/ciiya-sync/local'
import { resolvePhotoUploadPrincipal } from '../src/lib/photo-upload-principal'

const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_OWNER_ID = '22222222-2222-4222-8222-222222222222'
const ALBUM_ID = '33333333-3333-4333-8333-333333333333'
const DEVICE_TOKEN = `ciiya_sync_${'r'.repeat(43)}`

function source(relativePath: string) {
  return readFile(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    'utf8'
  )
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for Ciiya Sync release test condition')
}

function rolloutTest() {
  assert.equal(getCiiyaSyncRolloutMode(undefined), 'all')
  assert.equal(getCiiyaSyncRolloutMode('unexpected'), 'off')
  assert.equal(
    getCiiyaSyncRolloutDecision(OWNER_ID, { mode: 'all' }).enabled,
    true
  )
  assert.equal(
    getCiiyaSyncRolloutDecision(OWNER_ID, { mode: 'off' }).enabled,
    false
  )
  assert.equal(
    getCiiyaSyncRolloutDecision(OWNER_ID, {
      mode: 'canary',
      canaryOwnerIds: `${OTHER_OWNER_ID},${OWNER_ID}`,
    }).enabled,
    true
  )
  assert.equal(
    getCiiyaSyncRolloutDecision(OWNER_ID, {
      mode: 'canary',
      canaryOwnerIds: OTHER_OWNER_ID,
    }).reason,
    'not_in_canary'
  )
}

async function browserUploadBypassTest() {
  const previousMode = process.env.CIIYA_SYNC_ROLLOUT_MODE
  process.env.CIIYA_SYNC_ROLLOUT_MODE = 'off'

  try {
    const result = await resolvePhotoUploadPrincipal({
      request: new Request('https://ciiya.test/api/photos/upload-url'),
      browserClient: {
        auth: {
          async getUser() {
            return {
              data: { user: { id: OWNER_ID } },
              error: null,
            }
          },
        },
      } as never,
    })

    assert.equal(result.principal?.kind, 'browser')
    assert.equal(result.principal?.ownerId, OWNER_ID)
    assert.equal(result.rolloutDisabled, false)
  } finally {
    if (previousMode === undefined) {
      delete process.env.CIIYA_SYNC_ROLLOUT_MODE
    } else {
      process.env.CIIYA_SYNC_ROLLOUT_MODE = previousMode
    }
  }
}

async function rollbackQueueTest(root: string) {
  const photoPath = path.join(root, 'rollback-keeps-this-photo.jpg')
  const stateFilePath = path.join(root, 'state', 'queue.json')
  await writeFile(photoPath, Buffer.from('never-delete-during-rollback'))
  const photoStat = await stat(photoPath)
  const queueStore = new CiiyaSyncQueueStore(stateFilePath)
  await queueStore.enqueue({
    albumId: ALBUM_ID,
    source: 'ciiya-sync-live-folder',
    sourcePath: photoPath,
    fileName: path.basename(photoPath),
    contentType: 'image/jpeg',
    fileSizeBytes: photoStat.size,
    lastModifiedMs: photoStat.mtimeMs,
  })

  const engine = new CiiyaSyncEngine({
    apiBaseUrl: 'https://ciiya.test',
    deviceToken: DEVICE_TOKEN,
    stateFilePath,
    queueStore,
    watchFolder: false,
    retryBaseMs: 1_000,
    retryJitter: 0,
    fetchImplementation: async (input) => {
      assert.match(String(input), /\/api\/photos\/upload-url$/)
      return Response.json(
        {
          error: 'Ciiya Sync is temporarily paused',
          code: 'CIIYA_SYNC_ROLLOUT_PAUSED',
        },
        { status: 503, headers: { 'Retry-After': '60' } }
      )
    },
  })

  await engine.start()
  await waitFor(async () => (await queueStore.list())[0]?.status === 'retry_wait')
  await engine.stop()

  const item = (await queueStore.list())[0]
  assert.equal(item.status, 'retry_wait')
  assert.equal(item.error?.code, 'CIIYA_SYNC_ROLLOUT_PAUSED')
  assert.equal(item.error?.retryable, true)
  assert.equal(item.attempts, 1)
  assert.equal((await stat(photoPath)).isFile(), true)
}

async function releaseManifestTest(projectRoot: string, root: string) {
  const releaseDirectory = path.join(root, 'release')
  await mkdir(releaseDirectory, { recursive: true })
  const artifactPath = path.join(releaseDirectory, 'Ciiya-Sync-test.dmg')
  const bytes = Buffer.from('signed-release-fixture')
  await writeFile(artifactPath, bytes)
  const { manifest, manifestPath } = await buildCiiyaSyncReleaseManifest({
    projectRoot,
    releaseDirectory,
    channel: 'canary',
    generatedAt: '2026-09-23T00:00:00.000Z',
  })

  assert.equal(manifest.channel, 'canary')
  assert.equal(manifest.artifacts.length, 1)
  assert.equal(manifest.artifacts[0].sizeBytes, bytes.length)
  assert.equal(
    manifest.artifacts[0].sha256,
    createHash('sha256').update(bytes).digest('hex')
  )
  assert.doesNotMatch(await readFile(manifestPath, 'utf8'), /SECRET|TOKEN|CSC_/)
}

async function releaseContractTest() {
  const [
    uploadPrincipal,
    uploadRoute,
    finalizeRoute,
    albumsRoute,
    approvalRoute,
    builder,
    workflow,
    docs,
  ] = await Promise.all([
    source('src/lib/photo-upload-principal.ts'),
    source('src/app/api/photos/upload-url/route.ts'),
    source('src/app/api/photos/finalize-upload/route.ts'),
    source('src/app/api/ciiya-sync/albums/route.ts'),
    source('src/app/api/ciiya-sync/pairing/approve/route.ts'),
    source('desktop/ciiya-sync/electron-builder.yml'),
    source('.github/workflows/ciiya-sync-release.yml'),
    source('docs/ciiya-sync.md'),
  ])

  assert.match(uploadPrincipal, /getCiiyaSyncRolloutDecision/)
  assert.match(uploadRoute, /CIIYA_SYNC_ROLLOUT_PAUSED/)
  assert.match(finalizeRoute, /Retry-After/)
  assert.match(albumsRoute, /CIIYA_SYNC_ROLLOUT_PAUSED/)
  assert.match(approvalRoute, /CIIYA_SYNC_ROLLOUT_DISABLED/)
  assert.match(builder, /notarize: true/)
  assert.match(builder, /signingHashAlgorithms:[\s\S]*sha256/)
  assert.match(workflow, /workflow_dispatch/)
  assert.match(workflow, /--require-signing/)
  assert.match(docs, /14\.5\.8/)
}

async function main() {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url))
  const root = await mkdtemp(path.join(os.tmpdir(), 'ciiya-sync-release-'))
  try {
    rolloutTest()
    await browserUploadBypassTest()
    await rollbackQueueTest(root)
    await releaseManifestTest(projectRoot, root)
    await releaseContractTest()
    console.log('Ciiya Sync signed release, canary, and rollback checks passed.')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
