import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  resolvePhotoDelivery,
  resolvePublicStorageUrl,
} from '../src/lib/storage/delivery'

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'R2_PUBLIC_BASE_URL'] as const
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ciiya-test.supabase.co/'
  process.env.R2_PUBLIC_BASE_URL = 'https://media.example.com/ciiya/'

  const keyPrefix =
    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222'

  const r2Photo = resolvePhotoDelivery({
    storage_provider: 'r2',
    storage_bucket: 'ciiya-media',
    preview_path: `${keyPrefix}/preview/photo one.jpg`,
    thumbnail_path: `${keyPrefix}/thumbnail/photo one.jpg`,
    preview_url:
      'https://ciiya-test.supabase.co/storage/v1/object/public/albums/old-preview.jpg',
    original_url: 'https://example.com/private-original.jpg',
    sd_url: 'https://example.com/private-sd.jpg',
  })

  assert.equal(
    r2Photo.preview_url,
    `https://media.example.com/ciiya/${keyPrefix}/preview/photo%20one.jpg`
  )
  assert.equal(
    r2Photo.thumbnail_url,
    `https://media.example.com/ciiya/${keyPrefix}/thumbnail/photo%20one.jpg`
  )
  assert.equal(r2Photo.public_url, r2Photo.preview_url)
  assert.equal(r2Photo.original_url, null)
  assert.equal(r2Photo.sd_url, null)

  const legacyPhoto = resolvePhotoDelivery({
    storage_provider: 'supabase',
    storage_bucket: null,
    preview_path: `${keyPrefix}/preview/legacy.jpg`,
    thumbnail_path: `${keyPrefix}/thumbnail/legacy.jpg`,
  })

  assert.equal(
    legacyPhoto.preview_url,
    `https://ciiya-test.supabase.co/storage/v1/object/public/albums/${keyPrefix}/preview/legacy.jpg`
  )
  assert.equal(
    legacyPhoto.thumbnail_url,
    `https://ciiya-test.supabase.co/storage/v1/object/public/albums/${keyPrefix}/thumbnail/legacy.jpg`
  )

  assert.equal(
    resolvePublicStorageUrl({
      provider: 'r2',
      bucket: 'ciiya-media',
      key: `${keyPrefix}/original/private.jpg`,
    }),
    null
  )
  assert.equal(
    resolvePublicStorageUrl({
      provider: 'r2',
      bucket: 'ciiya-media',
      key: '../other-user/preview/photo.jpg',
    }),
    null
  )

  const sources = await Promise.all(
    [
      'src/lib/share-data.ts',
      'src/lib/storage/album-covers.ts',
      'src/app/albums/[id]/page.tsx',
      'src/app/albums/page.tsx',
      'src/app/api/faces/search/route.ts',
      'src/app/api/share/faces/route.ts',
      'src/app/notifications/page.tsx',
      'workers/photo-worker.ts',
      'src/app/api/presets/list/route.ts',
    ].map(async (path) => [path, await readFile(path, 'utf8')] as const)
  )
  const source = new Map(sources)

  assert.match(source.get('src/lib/share-data.ts')!, /resolvePhotoDeliveries/)
  assert.match(source.get('src/lib/share-data.ts')!, /storage_provider/)
  assert.match(
    source.get('src/lib/storage/album-covers.ts')!,
    /resolvePhotoDeliveries/
  )
  assert.match(
    source.get('src/app/albums/page.tsx')!,
    /resolveAlbumCoverDeliveries/
  )
  assert.match(
    source.get('src/app/albums/[id]/page.tsx')!,
    /resolvePublicStorageUrl/
  )
  assert.doesNotMatch(
    source.get('src/app/albums/[id]/page.tsx')!,
    /supabase\.storage/
  )
  assert.match(
    source.get('src/app/api/faces/search/route.ts')!,
    /resolvePhotoDelivery/
  )
  assert.match(
    source.get('src/app/api/share/faces/route.ts')!,
    /resolvePhotoDelivery/
  )
  assert.match(
    source.get('src/app/notifications/page.tsx')!,
    /resolvePhotoDelivery/
  )
  assert.match(source.get('workers/photo-worker.ts')!, /resolvePublicStorageUrl/)
  assert.doesNotMatch(
    source.get('workers/photo-worker.ts')!,
    /supabase\.storage/
  )
  assert.match(
    source.get('src/app/api/presets/list/route.ts')!,
    /getStorageAdapter\('supabase'/
  )
  assert.doesNotMatch(
    source.get('src/app/api/presets/list/route.ts')!,
    /supabase\.storage/
  )

  console.log('Phase 12 dual-provider read-path checks passed')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
