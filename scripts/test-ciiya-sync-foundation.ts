import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createCiiyaSyncDeviceToken,
  createCiiyaSyncPairingCredentials,
  formatCiiyaSyncUserCode,
  hashCiiyaSyncSecret,
  normalizeCiiyaSyncDeviceName,
  normalizeCiiyaSyncPlatform,
  normalizeCiiyaSyncUserCode,
} from '../src/lib/ciiya-sync/server'

function source(relativePath: string) {
  return readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    'utf8'
  )
}

const pairing = createCiiyaSyncPairingCredentials()
assert.match(pairing.userCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)
assert.equal(pairing.formattedUserCode, formatCiiyaSyncUserCode(pairing.userCode))
assert.equal(normalizeCiiyaSyncUserCode(pairing.formattedUserCode), pairing.userCode)
assert.match(pairing.userCodeHash, /^[a-f0-9]{64}$/)
assert.match(pairing.pollSecret, /^[A-Za-z0-9_-]{43}$/)
assert.equal(pairing.pollSecretHash, hashCiiyaSyncSecret(pairing.pollSecret))

const token = createCiiyaSyncDeviceToken()
assert.match(token, /^ciiya_sync_[A-Za-z0-9_-]{43}$/)
assert.match(hashCiiyaSyncSecret(token), /^[a-f0-9]{64}$/)
assert.notEqual(createCiiyaSyncDeviceToken(), token)

assert.equal(normalizeCiiyaSyncUserCode('abcd efgh'), 'ABCDEFGH')
assert.equal(normalizeCiiyaSyncUserCode('ABCI-EFGH'), null)
assert.equal(normalizeCiiyaSyncPlatform('Darwin'), 'unknown')
assert.equal(normalizeCiiyaSyncPlatform('macOS'), 'macos')
assert.equal(normalizeCiiyaSyncDeviceName('  Studio\u0000 Mac  '), 'Studio Mac')

const migration = source(
  'supabase/migrations/202609230002_ciiya_sync_foundation.sql'
)
assert.match(migration, /create table if not exists public\.ciiya_sync_devices/)
assert.match(migration, /create table if not exists public\.ciiya_sync_pairings/)
assert.match(migration, /token_hash text not null unique/)
assert.match(migration, /poll_secret_hash text not null/)
assert.match(migration, /alter table public\.ciiya_sync_devices enable row level security/)
assert.match(migration, /revoke all on table public\.ciiya_sync_pairings from anon, authenticated/)
assert.match(migration, /to service_role/)
assert.doesNotMatch(migration, /token\s+text/i)

const startRoute = source('src/app/api/ciiya-sync/pairing/start/route.ts')
assert.match(startRoute, /ciiya-sync-pairing-start/)
assert.match(startRoute, /poll_secret_hash: credentials\.pollSecretHash/)
assert.match(startRoute, /verificationUriComplete/)

const approvalRoute = source('src/app/api/ciiya-sync/pairing/approve/route.ts')
assert.match(approvalRoute, /supabase\.auth\.getUser\(\)/)
assert.match(approvalRoute, /approve_ciiya_sync_pairing/)

const statusRoute = source('src/app/api/ciiya-sync/pairing/status/route.ts')
assert.match(statusRoute, /consume_ciiya_sync_pairing/)
assert.match(statusRoute, /token_issued/)

const albumsRoute = source('src/app/api/ciiya-sync/albums/route.ts')
assert.match(albumsRoute, /authenticateCiiyaSyncDevice/)
assert.match(albumsRoute, /'albums:read'/)
assert.match(albumsRoute, /owner_id\.eq/)

const devicesRoute = source('src/app/api/ciiya-sync/devices/route.ts')
assert.match(devicesRoute, /supabase\.auth\.getUser\(\)/)
assert.match(devicesRoute, /\.eq\('owner_id', user\.id\)/)
assert.match(devicesRoute, /revoked_at: revokedAt/)
assert.match(devicesRoute, /\.is\('revoked_at', null\)/)

const devicePage = source('src/app/me/ciiya-sync/page.tsx')
assert.match(devicePage, /CiiyaSyncDevices/)
assert.match(devicePage, /\.eq\('owner_id', user\.id\)/)

const deviceList = source('src/components/ciiya-sync-devices.tsx')
assert.match(deviceList, /\/api\/ciiya-sync\/devices/)
assert.match(deviceList, /method: 'DELETE'/)
assert.match(deviceList, /Disconnect/)

const mePage = source('src/app/me/page.tsx')
assert.match(mePage, /href: '\/me\/ciiya-sync'/)

const uploadMigration = source(
  'supabase/migrations/202609230003_ciiya_sync_upload.sql'
)
assert.match(uploadMigration, /add column if not exists ciiya_sync_device_id uuid/)
assert.match(uploadMigration, /reserve_ciiya_sync_photo_upload/)
assert.match(uploadMigration, /cancel_ciiya_sync_photo_upload/)
assert.match(uploadMigration, /begin_ciiya_sync_photo_upload_finalization/)
assert.match(uploadMigration, /complete_ciiya_sync_photo_upload_finalization/)
assert.match(uploadMigration, /and s\.ciiya_sync_device_id = p_device_id/)
assert.match(uploadMigration, /p_required_scope = any\(d\.scopes\)/)
assert.match(uploadMigration, /from public, anon, authenticated/)
assert.match(uploadMigration, /to service_role/)
assert.doesNotMatch(uploadMigration, /grant execute[\s\S]*to authenticated/)

const fullSchema = source('supabase/schema.sql')
assert.match(fullSchema, /SCHEMA v2\.6 — Ciiya Sync device uploads/)
assert.match(fullSchema, /add column if not exists ciiya_sync_device_id uuid/)
assert.match(fullSchema, /reserve_ciiya_sync_photo_upload/)
assert.match(fullSchema, /complete_ciiya_sync_photo_upload_finalization/)

const uploadPrincipal = source('src/lib/photo-upload-principal.ts')
assert.match(uploadPrincipal, /authenticateCiiyaSyncDevice/)
assert.match(uploadPrincipal, /'photos:upload'/)
assert.match(uploadPrincipal, /explicit device credential/)
assert.match(uploadPrincipal, /kind: 'ciiya-sync'/)

const uploadUrlRoute = source('src/app/api/photos/upload-url/route.ts')
assert.match(uploadUrlRoute, /resolvePhotoUploadPrincipal/)
assert.match(uploadUrlRoute, /reserve_ciiya_sync_photo_upload/)
assert.match(uploadUrlRoute, /cancel_ciiya_sync_photo_upload/)
assert.match(uploadUrlRoute, /SYNC_PRESET_NOT_ALLOWED/)
assert.match(uploadUrlRoute, /const ownerId = principal\.ownerId/)

const finalizeRoute = source('src/app/api/photos/finalize-upload/route.ts')
assert.match(finalizeRoute, /resolvePhotoUploadPrincipal/)
assert.match(finalizeRoute, /begin_ciiya_sync_photo_upload_finalization/)
assert.match(finalizeRoute, /complete_ciiya_sync_photo_upload_finalization/)
assert.match(finalizeRoute, /ciiya-sync-live-folder/)
assert.match(finalizeRoute, /ciiya-sync-export-selection/)
assert.match(finalizeRoute, /ciiyaSyncDeviceId/)
assert.match(finalizeRoute, /Ciiya Sync uploads require R2 storage/)

const syncDoc = source('docs/ciiya-sync.md')
assert.match(syncDoc, /Phase 14\.5 — Ciiya Sync/)
assert.match(syncDoc, /Live Folder/)
assert.match(syncDoc, /Export Selection/)
assert.match(syncDoc, /Subphase 14\.5\.2/)
assert.match(syncDoc, /Subphase 14\.5\.3/)
assert.match(syncDoc, /Subphase 14\.5\.4/)
assert.match(syncDoc, /Subphase 14\.5\.5/)
assert.match(syncDoc, /Subphase 14\.5\.6/)
assert.match(syncDoc, /Subphase 14\.5\.7/)
assert.match(syncDoc, /Device-authenticated R2 upload reservation\/finalization \| Complete/)
assert.match(syncDoc, /Local queue, stable-file watcher, retries, offline recovery \| Complete/)
assert.match(syncDoc, /Ciiya Sync desktop shell for macOS and Windows \| Complete/)
assert.match(syncDoc, /Lightroom Export Selection integration and local-copy workflow \| Complete/)
assert.match(syncDoc, /Live Folder session UI, Realtime status, telemetry \| Complete/)

const localEngine = source('src/lib/ciiya-sync/local/sync-engine.ts')
assert.match(localEngine, /recoverInterrupted\(\)/)
assert.match(localEngine, /retry_wait/)
assert.match(localEngine, /CiiyaSyncSourceChangedError/)

const localQueue = source('src/lib/ciiya-sync/local/queue-store.ts')
assert.match(localQueue, /mode: 0o600/)
assert.match(localQueue, /open\(temporaryPath, 'r\+'\)/)
assert.match(localQueue, /\.corrupt-/)
assert.doesNotMatch(localQueue, /deviceToken/)

for (const durableDesktopStore of [
  source('desktop/ciiya-sync/src/settings-store.ts'),
  source('desktop/ciiya-sync/src/session-telemetry.ts'),
  source('desktop/ciiya-sync/src/lightroom-plugin.ts'),
]) {
  assert.doesNotMatch(durableDesktopStore, /open\([^\n]+, 'r'\)/)
  assert.match(durableDesktopStore, /open\([^\n]+, 'r\+'\)/)
}

const localUploader = source('src/lib/ciiya-sync/local/upload-client.ts')
assert.match(localUploader, /Readable\.toWeb/)
assert.match(localUploader, /Authorization: `Bearer \$\{this\.deviceToken\}`/)
assert.match(localUploader, /assertSourceMatches/)

console.log('Ciiya Sync foundation and upload contracts passed.')
