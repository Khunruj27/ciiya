import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createPhotoReprocessRevision,
  isReprocessableOriginalPath,
  photoReprocessPayload,
  readPhotoReprocessRequest,
  supersededPhotoObjectKeys,
} from '../src/lib/photo-reprocess'
import { buildPhotoWorkerObjectPlan } from '../src/lib/storage/photo-worker-plan'

const ownerId = '11111111-1111-4111-8111-111111111111'
const albumId = '22222222-2222-4222-8222-222222222222'
const name = '33333333-3333-4333-8333-333333333333'
const original = `${ownerId}/${albumId}/original/${name}.webp`
const key = (folder: string, suffix = '') => `${ownerId}/${albumId}/${folder}/${name}${suffix}.jpg`

test('revisions are short, lowercase and unique', () => {
  const values = new Set(Array.from({ length: 200 }, createPhotoReprocessRevision))
  assert.equal(values.size, 200)
  for (const value of values) assert.match(value, /^[a-z0-9]{10}$/)
})

test('only a well-formed reprocess payload is read back', () => {
  const payload = photoReprocessPayload('abcdef1234')
  assert.deepEqual(readPhotoReprocessRequest(payload), { revision: 'abcdef1234' })
  assert.deepEqual(readPhotoReprocessRequest(JSON.parse(JSON.stringify(payload))), { revision: 'abcdef1234' })
  for (const bad of [
    null, undefined, 'x', [], {},
    { source: 'mobile-manual-retry' },
    { ...payload, reprocess: 'true' },
    { ...payload, source: 'photo-worker' },
    { ...payload, revision: '../x' },
    { ...payload, revision: 'ABCDEF1234' },
    { ...payload, revision: 'short' },
  ]) {
    assert.equal(readPhotoReprocessRequest(bad), null, JSON.stringify(bad))
  }
  assert.throws(() => photoReprocessPayload('bad/one'))
})

test('a reprocess payload may carry a preset, or null for none; absent means keep', () => {
  const preset = `${ownerId}/${albumId}/presets/r6.xmp`
  assert.deepEqual(readPhotoReprocessRequest(photoReprocessPayload('abcdef1234', preset)), { revision: 'abcdef1234', presetPath: preset })
  assert.deepEqual(readPhotoReprocessRequest(photoReprocessPayload('abcdef1234', null)), { revision: 'abcdef1234', presetPath: null })
  assert.ok(!('presetPath' in photoReprocessPayload('abcdef1234')))
  for (const bad of [5, '', 'x.jpg', '../a.xmp', 'a//b.xmp', 'a\\b.xmp', `${'a'.repeat(500)}.xmp`]) {
    assert.equal(readPhotoReprocessRequest({ ...photoReprocessPayload('abcdef1234'), presetPath: bad }), null, String(bad))
    assert.throws(() => photoReprocessPayload('abcdef1234', bad as string))
  }
})

test('only a raw upload in this album can be rendered again', () => {
  assert.equal(isReprocessableOriginalPath(original, ownerId, albumId), true)
  for (const path of [
    key('preview'),
    key('hd'),
    `${ownerId}/44444444-4444-4444-8444-444444444444/original/${name}.jpg`,
    `${ownerId}/${albumId}/original/../x.jpg`,
    null,
    '',
  ]) {
    assert.equal(isReprocessableOriginalPath(path, ownerId, albumId), false, String(path))
  }
})

test('a revision gives every derived object a new key, never the original', () => {
  for (const provider of ['r2', 'supabase'] as const) {
    for (const selectedSize of ['sd', 'hd', 'uhd'] as const) {
      const before = buildPhotoWorkerObjectPlan({ provider, originalKey: original, selectedSize, hasPreset: true })
      const after = buildPhotoWorkerObjectPlan({
        provider, originalKey: original, selectedSize, hasPreset: true, revision: 'abcdef1234',
      })
      assert.notEqual(after.previewKey, before.previewKey)
      assert.notEqual(after.thumbnailKey, before.thumbnailKey)
      assert.equal(after.thumbnailKey, key('thumbnail', '-abcdef1234'))
      if (before.selectedDerivativeKey) {
        assert.equal(after.selectedDerivativeKey, key(selectedSize, '-abcdef1234'))
      }
      assert.equal(after.shouldRelocateSupabaseOriginal, before.shouldRelocateSupabaseOriginal)
    }
  }
  const r2Original = buildPhotoWorkerObjectPlan({
    provider: 'r2', originalKey: original, selectedSize: 'original', hasPreset: false, revision: 'abcdef1234',
  })
  assert.equal(r2Original.previewKey, key('preview', '-abcdef1234'))
  // Supabase delivering the untouched original keeps pointing at it.
  const legacyOriginal = buildPhotoWorkerObjectPlan({
    provider: 'supabase', originalKey: original, selectedSize: 'original', hasPreset: false, revision: 'abcdef1234',
  })
  assert.equal(legacyOriginal.previewKey, original)
  assert.throws(() =>
    buildPhotoWorkerObjectPlan({ provider: 'r2', originalKey: original, selectedSize: 'hd', hasPreset: false, revision: '../x' })
  )
})

test('without a revision the plan is unchanged', () => {
  const plan = buildPhotoWorkerObjectPlan({ provider: 'r2', originalKey: original, selectedSize: 'hd', hasPreset: true })
  assert.equal(plan.previewKey, key('preview'))
  assert.equal(plan.thumbnailKey, key('thumbnail'))
  assert.equal(plan.selectedDerivativeKey, key('hd'))
})

test('superseded keys are the previous render only, never the original, new or foreign keys', () => {
  const current = [key('preview', '-abcdef1234'), key('thumbnail', '-abcdef1234'), key('hd', '-abcdef1234')]
  const stale = supersededPhotoObjectKeys({
    ownerId,
    albumId,
    originalPath: original,
    previous: [
      key('preview'), key('thumbnail'), key('hd'), key('sd'), // the old render and a lazily made size
      original, // the raw upload
      current[0], // a retry after a commit already points here
      `${ownerId}/${albumId}/cover/${name}.jpg`,
      `${ownerId}/${albumId}/presets/${name}.xmp`,
      `${ownerId}/44444444-4444-4444-8444-444444444444/preview/${name}.jpg`,
      `${ownerId}/${albumId}/preview/../x.jpg`,
      null, undefined, '', key('preview'),
    ],
    current,
  })
  assert.deepEqual(stale.sort(), [key('hd'), key('preview'), key('sd'), key('thumbnail')].sort())
})

// The worker module starts polling on import, so its reprocess invariants are
// pinned on the source: these are the behaviours a reprocess must keep.
test('the worker keeps a reprocessed photo visible and its faces intact', () => {
  const source = readFileSync(new URL('../workers/photo-worker.ts', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('async function processPhotoJob'))

  assert.match(body, /storageContext\.previous\.processingStatus === 'done'\s*\?\s*readPhotoReprocessRequest\(job\.payload\)/)
  assert.match(body, /if \(!reprocess\) \{\s*await updatePhoto\(String\(job\.photo_id\), \{\s*processing_status: 'processing'/)
  assert.match(body, /revision: reprocess\?\.revision \?\? null/)
  assert.match(body, /reprocess && objectPlan\.shouldReplaceSupabaseRawOriginal/)
  assert.match(body, /\.\.\.\(reprocess\s*\?\s*\{\}\s*:\s*\{\s*face_scan_status/)
  assert.match(body, /\{ keepPhotoStatus: isReprocess \}/)
  assert.match(body, /failureRecorded === 'failed' && uncommittedReprocessObjects/)
  // The previous render is removed only after the row points at the new one.
  const commit = body.indexOf(".update(finalPayload)")
  const cleanup = body.indexOf('await finishPhotoReprocess(')
  assert.ok(commit > 0 && cleanup > commit)
  assert.match(source, /if \(job\.photo_id && !options\.keepPhotoStatus\)/)
})
