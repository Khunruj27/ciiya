import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { installerDownloadResponse } from '../src/lib/ciiya-sync/installer-download'
import { CIIYA_SYNC_INSTALLERS, ciiyaSyncInstallerKey, findCiiyaSyncInstaller } from '../src/lib/ciiya-sync/installers'
import type { StorageAdapter } from '../src/lib/storage/types'

async function main() {
  const installer = CIIYA_SYNC_INSTALLERS[0]
  let storageCalls = 0
  const adapter: Pick<StorageAdapter, 'objectExists' | 'getSignedDownloadUrl'> = {
    objectExists: async () => ({ exists: true, sizeBytes: installer.bytes, etag: null, contentType: null, lastModified: null }),
    getSignedDownloadUrl: async (ref, options) => {
      assert.equal(ref.key, ciiyaSyncInstallerKey(installer))
      assert.equal(options.expiresInSeconds, 900)
      assert.equal(options.downloadName, installer.filename)
      return 'https://downloads.example.test/installer'
    },
  }
  const base = {
    installerId: installer.id, authenticated: true, rolloutEnabled: true,
    getStorage: () => { storageCalls++; return { adapter, bucket: 'test-releases' } },
  }
  assert.equal((await installerDownloadResponse({ ...base, authenticated: false })).status, 401)
  assert.equal((await installerDownloadResponse({ ...base, rolloutEnabled: false })).status, 403)
  for (const id of [null, '../secret', '__proto__', 'https://evil.test', 'mac-intel']) {
    assert.equal(findCiiyaSyncInstaller(id), undefined)
    assert.equal((await installerDownloadResponse({ ...base, installerId: id })).status, 400)
  }
  assert.equal(storageCalls, 0)
  const response = await installerDownloadResponse(base)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Cache-Control')!, /no-store/)
  assert.deepEqual(await response.json(), { url: 'https://downloads.example.test/installer' })
  adapter.objectExists = async () => ({ exists: false, sizeBytes: null, etag: null, contentType: null, lastModified: null })
  assert.equal((await installerDownloadResponse(base)).status, 503)
  adapter.objectExists = async () => ({ exists: true, sizeBytes: 12, etag: null, contentType: null, lastModified: null })
  assert.equal((await installerDownloadResponse(base)).status, 503)
  const failed = await installerDownloadResponse({ ...base, getStorage: () => { throw new Error('secret') } })
  assert.equal(failed.status, 503)
  assert.doesNotMatch(await failed.text(), /secret/)
  const route = await readFile('src/app/api/ciiya-sync/download/route.ts', 'utf8')
  assert.match(route, /supabase\.auth\.getUser\(\)/)
  assert.match(route, /getCiiyaSyncRolloutDecision\(user.id\)/)
  assert.match(route, /rateLimit/)
  console.log('Installer auth, rollout, allowlist, missing artifacts, signed delivery and no-store checks passed.')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
