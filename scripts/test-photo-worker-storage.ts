import assert from 'node:assert/strict'
import { buildPhotoWorkerObjectPlan } from '../src/lib/storage/photo-worker-plan'
import { isValidFaceSourceObjectKey } from '../src/lib/storage/paths'

const original =
  '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/original/33333333-3333-4333-8333-333333333333.webp'

const r2Original = buildPhotoWorkerObjectPlan({
  provider: 'r2',
  originalKey: original,
  selectedSize: 'original',
  hasPreset: false,
})

assert.equal(
  r2Original.previewKey,
  original.replace('/original/', '/preview/').replace(/\.webp$/, '.jpg')
)
assert.equal(r2Original.selectedDerivativeKey, null)
assert.equal(r2Original.shouldUploadPreview, true)
assert.equal(r2Original.shouldRelocateSupabaseOriginal, false)

const r2Hd = buildPhotoWorkerObjectPlan({
  provider: 'r2',
  originalKey: original,
  selectedSize: 'hd',
  hasPreset: true,
})

assert.equal(
  r2Hd.selectedDerivativeKey,
  original.replace('/original/', '/hd/').replace(/\.webp$/, '.jpg')
)
assert.equal(r2Hd.previewKey.includes('/preview/'), true)

const legacyHd = buildPhotoWorkerObjectPlan({
  provider: 'supabase',
  originalKey: original,
  selectedSize: 'hd',
  hasPreset: false,
})

assert.equal(legacyHd.previewKey.includes('/hd/'), true)
assert.equal(legacyHd.shouldRelocateSupabaseOriginal, true)

const legacyOriginalWithPreset = buildPhotoWorkerObjectPlan({
  provider: 'supabase',
  originalKey: original,
  selectedSize: 'original',
  hasPreset: true,
})

assert.equal(legacyOriginalWithPreset.previewKey.includes('/preview/'), true)
assert.equal(legacyOriginalWithPreset.shouldReplaceSupabaseRawOriginal, true)

assert.throws(
  () =>
    buildPhotoWorkerObjectPlan({
      provider: 'r2',
      originalKey: original.replace('/original/', '/thumbnail/'),
      selectedSize: 'hd',
      hasPreset: false,
    }),
  /original object key/
)

const ownerId = '11111111-1111-4111-8111-111111111111'
const albumId = '22222222-2222-4222-8222-222222222222'

for (const kind of ['uhd', 'hd', 'preview', 'original']) {
  assert.equal(
    isValidFaceSourceObjectKey(
      `${ownerId}/${albumId}/${kind}/33333333-3333-4333-8333-333333333333.jpg`,
      ownerId,
      albumId
    ),
    true
  )
}

assert.equal(
  isValidFaceSourceObjectKey(
    `${ownerId}/${albumId}/thumbnail/33333333-3333-4333-8333-333333333333.jpg`,
    ownerId,
    albumId
  ),
  false
)

assert.equal(
  isValidFaceSourceObjectKey(
    `${ownerId}/${albumId}/uhd/../original/33333333-3333-4333-8333-333333333333.jpg`,
    ownerId,
    albumId
  ),
  false
)

console.log('Photo Worker storage plan checks passed')
