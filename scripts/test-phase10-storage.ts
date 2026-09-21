import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  getStorageAssetTarget,
  guestMomentImageKey,
  isOwnedGuestMomentObjectKey,
  isOwnedPortfolioObjectKey,
  isOwnedPresetObjectKey,
  portfolioImageKey,
  presetObjectKey,
} from '../src/lib/storage'

const ownerId = '11111111-1111-4111-8111-111111111111'
const otherOwnerId = '22222222-2222-4222-8222-222222222222'
const albumId = '33333333-3333-4333-8333-333333333333'
const objectId = '44444444-4444-4444-8444-444444444444'

const envNames = [
  'STORAGE_DEFAULT_PROVIDER',
  'R2_UPLOADS_ENABLED',
  'R2_UPLOAD_CANARY_OWNER_IDS',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT',
  'R2_PUBLIC_BASE_URL',
] as const
const savedEnv = new Map(envNames.map((name) => [name, process.env[name]]))

function configureR2(publicBaseUrl?: string) {
  process.env.STORAGE_DEFAULT_PROVIDER = 'r2'
  process.env.R2_UPLOADS_ENABLED = 'true'
  process.env.R2_ACCOUNT_ID = 'account'
  process.env.R2_ACCESS_KEY_ID = 'access'
  process.env.R2_SECRET_ACCESS_KEY = 'secret'
  process.env.R2_BUCKET_NAME = 'ciiya-assets'
  process.env.R2_ENDPOINT = 'https://account.r2.cloudflarestorage.com'
  delete process.env.R2_UPLOAD_CANARY_OWNER_IDS

  if (publicBaseUrl) process.env.R2_PUBLIC_BASE_URL = publicBaseUrl
  else delete process.env.R2_PUBLIC_BASE_URL
}

async function main() {
try {
  process.env.STORAGE_DEFAULT_PROVIDER = 'supabase'
  process.env.R2_UPLOADS_ENABLED = 'false'
  assert.deepEqual(getStorageAssetTarget('portfolio', ownerId), {
    provider: 'supabase',
    bucket: 'albums',
  })
  assert.deepEqual(getStorageAssetTarget('guest_moment', ownerId), {
    provider: 'supabase',
    bucket: 'guest-moments',
  })

  configureR2()
  assert.equal(getStorageAssetTarget('preset', ownerId).provider, 'r2')
  assert.equal(
    getStorageAssetTarget('portfolio', ownerId).provider,
    'supabase',
    'public assets must wait for a stable R2 public domain'
  )

  configureR2('https://media.ciiya.test')
  assert.deepEqual(getStorageAssetTarget('portfolio', ownerId), {
    provider: 'r2',
    bucket: 'ciiya-assets',
  })
  assert.deepEqual(getStorageAssetTarget('guest_moment', ownerId), {
    provider: 'r2',
    bucket: 'ciiya-assets',
  })

  const portfolioKey = portfolioImageKey({ ownerId, objectId })
  const guestKey = guestMomentImageKey({ ownerId, albumId, objectId })
  const presetKey = presetObjectKey({ ownerId, albumId, objectId })

  assert.equal(isOwnedPortfolioObjectKey(portfolioKey, ownerId), true)
  assert.equal(isOwnedPortfolioObjectKey(portfolioKey, otherOwnerId), false)
  assert.equal(
    isOwnedGuestMomentObjectKey(guestKey, ownerId, albumId),
    true
  )
  assert.equal(
    isOwnedGuestMomentObjectKey(guestKey, otherOwnerId, albumId),
    false
  )
  assert.equal(isOwnedPresetObjectKey(presetKey, ownerId, albumId), true)
  assert.equal(isOwnedPresetObjectKey(presetKey, ownerId), false)

  const [
    portfolioEditor,
    guestMoments,
    presetUpload,
    photoWorker,
    albumCover,
    albumDelete,
  ] =
    await Promise.all([
      readFile(
        new URL('../src/components/portfolio-editor.tsx', import.meta.url),
        'utf8'
      ),
      readFile(
        new URL('../src/app/api/share/moments/route.ts', import.meta.url),
        'utf8'
      ),
      readFile(
        new URL('../src/app/api/presets/upload/route.ts', import.meta.url),
        'utf8'
      ),
      readFile(new URL('../workers/photo-worker.ts', import.meta.url), 'utf8'),
      readFile(
        new URL('../src/app/api/albums/cover/route.ts', import.meta.url),
        'utf8'
      ),
      readFile(
        new URL('../src/app/api/albums/delete/route.ts', import.meta.url),
        'utf8'
      ),
    ])

  assert.match(portfolioEditor, /api\/portfolio\/assets\/upload-url/)
  assert.match(portfolioEditor, /api\/portfolio\/assets\/finalize/)
  assert.doesNotMatch(portfolioEditor, /supabase\.storage/)
  assert.match(guestMoments, /getStorageAssetTarget\('guest_moment', ownerId\)/)
  assert.doesNotMatch(guestMoments, /\.storage\.from\('guest-moments'\)/)
  assert.match(presetUpload, /getStorageAssetTarget\('preset', user\.id\)/)
  assert.doesNotMatch(presetUpload, /\.storage\s*\n?\s*\.from\('presets'\)/)
  assert.match(photoWorker, /resolvePresetStorageRef/)
  assert.match(albumCover, /cover_photo_id: photoId, cover_url: coverUrl/)
  assert.match(albumDelete, /\.from\('storage_assets'\)/)
  assert.match(albumDelete, /buildLegacyGuestMomentDeletionTarget/)

  console.log('Phase 10 storage contract checks passed')
} finally {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
