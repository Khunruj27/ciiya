import assert from 'node:assert/strict'
import { getGalleryWindow } from '../src/lib/gallery-window'
import { loadModelsInParallel } from '../src/lib/parallel-model-loader'

async function main() {
  const base = { top: 0, viewportHeight: 800, rowHeight: 200, rowCount: 250 }
  assert.deepEqual(getGalleryWindow(base), { startRow: 0, endRow: 7 })
  assert.deepEqual(getGalleryWindow({ ...base, top: -10_000 }), { startRow: 47, endRow: 57 })
  assert.deepEqual(getGalleryWindow({ ...base, top: 900 }), { startRow: 0, endRow: 0 })
  assert.deepEqual(getGalleryWindow({ ...base, top: -50_000 }), { startRow: 0, endRow: 0 })
  assert.deepEqual(getGalleryWindow({ ...base, viewportHeight: 0 }), { startRow: 0, endRow: 0 })
  assert.deepEqual(getGalleryWindow({ ...base, rowCount: 0 }), { startRow: 0, endRow: 0 })
  assert.deepEqual(getGalleryWindow({ ...base, rowHeight: 0 }), { startRow: 0, endRow: 0 })
  assert.deepEqual(getGalleryWindow({ ...base, top: -49_400 }), { startRow: 244, endRow: 250 })

  for (const columns of [2, 3, 4, 5, 6]) {
    for (const viewportHeight of [390, 800, 1600]) {
      for (let row = 0; row < 250; row++) {
        const range = getGalleryWindow({ ...base, top: -row * 200 - 50, viewportHeight })
        assert.ok(range.startRow <= row && range.endRow > row, 'visible rows never disappear')
        assert.ok(range.startRow >= 0 && range.endRow <= base.rowCount)
        assert.ok((range.endRow - range.startRow) * columns <= (Math.ceil(viewportHeight / 200) + 7) * columns)
      }
    }
  }

  // Deferred model requests prove all three start before any completes.
  const calls: number[] = []
  const resolvers: (() => void)[] = []
  const models = [0, 1, 2].map((index) => ({
    isLoaded: false,
    loadFromUri(uri: string) {
      assert.equal(uri, '/models')
      calls.push(index)
      return new Promise<void>((resolve) => resolvers[index] = () => { this.isLoaded = true; resolve() })
    },
  }))
  let progress = 0
  const pending = loadModelsInParallel(models, '/models', () => progress++)
  assert.deepEqual(calls, [0, 1, 2])
  resolvers[2]()
  resolvers[0]()
  resolvers[1]()
  await pending
  assert.equal(progress, 3)
  await loadModelsInParallel(models, '/models')
  assert.equal(calls.length, 3, 'loaded models are not downloaded twice')

  let completeSlow!: () => void
  let settled = false
  const failure = new Error('temporary model failure')
  const retryModels = [
    { isLoaded: false, async loadFromUri() { throw failure } },
    { isLoaded: false, loadFromUri() { return new Promise<void>((resolve) => completeSlow = () => { this.isLoaded = true; resolve() }) } },
  ]
  const failed = loadModelsInParallel(retryModels, '/models').catch((error) => { settled = true; return error })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false, 'retry must wait for all in-flight model loads')
  completeSlow()
  assert.equal(await failed, failure)
  retryModels[0].loadFromUri = async () => { retryModels[0].isLoaded = true }
  await loadModelsInParallel(retryModels, '/models')
  assert.ok(retryModels.every((model) => model.isLoaded))

  const range = getGalleryWindow({ ...base, top: -10_000 })
  console.log(`PASS: viewport/density/boundary cases; 1,000 photos -> ${(range.endRow - range.startRow) * 4} mounted cells in the 800px test viewport (previously 1,000).`)
  console.log('PASS: parallel model loading, loaded-model reuse, failure settlement and retry.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
